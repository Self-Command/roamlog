#!/usr/bin/env python3
"""Static release checks for Docker, staging configuration, and CI workflows."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required. Install it with `python -m pip install PyYAML`.", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[2]
errors: list[str] = []
warnings: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def read(relative_path: str) -> str:
    path = ROOT / relative_path
    check(path.exists(), f"Missing required file: {relative_path}")
    return path.read_text(encoding="utf-8") if path.exists() else ""


def load_yaml(relative_path: str) -> dict:
    text = read(relative_path)
    if not text:
        return {}
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        errors.append(f"Invalid YAML in {relative_path}: {exc}")
        return {}
    check(isinstance(data, dict), f"{relative_path} must contain a YAML mapping")
    return data if isinstance(data, dict) else {}


def parse_env(relative_path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in read(relative_path).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def require_env_keys(relative_path: str, keys: set[str]) -> None:
    values = parse_env(relative_path)
    missing = sorted(keys - values.keys())
    check(not missing, f"{relative_path} is missing: {', '.join(missing)}")


compose = load_yaml("docker/compose.yml")
staging = load_yaml("docker/compose.staging.yml")
production = load_yaml("docker/compose.production.yml")
ci = load_yaml(".github/workflows/ci.yml")
release = load_yaml(".github/workflows/release.yml")

# Compose service, network, health, and persistence coverage.
local_services = compose.get("services", {})
for service in {"postgres", "redis", "minio", "minio-init", "mailpit"}:
    check(service in local_services, f"docker/compose.yml is missing {service}")
for service in {"postgres", "redis", "minio", "mailpit"}:
    definition = local_services.get(service, {})
    check(bool(definition.get("healthcheck")), f"Local {service} needs a healthcheck")
for volume in {"postgres-data", "redis-data", "minio-data"}:
    check(volume in compose.get("volumes", {}), f"docker/compose.yml is missing volume {volume}")

staging_services = staging.get("services", {})
required_staging = {
    "postgres",
    "redis",
    "minio",
    "minio-init",
    "mailpit",
    "migrate",
    "api",
    "worker",
    "web",
    "admin",
}
for service in required_staging:
    check(service in staging_services, f"docker/compose.staging.yml is missing {service}")
for service in {"postgres", "redis", "minio", "mailpit"}:
    check(
        bool(staging_services.get(service, {}).get("healthcheck")),
        f"Staging {service} needs a healthcheck",
    )
for volume in {"postgres-data", "redis-data", "minio-data"}:
    check(
        volume in staging.get("volumes", {}),
        f"docker/compose.staging.yml is missing volume {volume}",
    )

backend = staging.get("networks", {}).get("backend", {})
check(bool(backend.get("internal")), "The staging backend network must be internal")
check("edge" in staging.get("networks", {}), "The staging edge network is missing")
check("egress" in staging.get("networks", {}), "The staging worker egress network is missing")

for service in {"api", "worker", "web", "admin", "migrate"}:
    definition = staging_services.get(service, {})
    check(definition.get("read_only") is True, f"Staging {service} must use a read-only root FS")
    check("ALL" in definition.get("cap_drop", []), f"Staging {service} must drop all capabilities")
    check(
        "no-new-privileges:true" in definition.get("security_opt", []),
        f"Staging {service} must set no-new-privileges",
    )
for service in {"postgres", "redis"}:
    check(not staging_services.get(service, {}).get("ports"), f"Staging {service} must stay private")
for service in {"api", "web", "admin", "mailpit", "minio"}:
    for port in staging_services.get(service, {}).get("ports", []):
        check(str(port).startswith("127.0.0.1:"), f"Staging {service} port must bind loopback only")

api_definition = staging_services.get("api", {})
check(
    isinstance(api_definition.get("depends_on", {}).get("migrate"), dict),
    "Staging API must wait for the migration job",
)
check(
    api_definition.get("environment", {}).get("DATABASE_URL", "").find("${POSTGRES_PASSWORD") >= 0,
    "Staging API must interpolate POSTGRES_PASSWORD",
)
check(
    api_definition.get("environment", {}).get("REDIS_URL", "").find("${REDIS_PASSWORD") >= 0,
    "Staging API must interpolate REDIS_PASSWORD",
)
check(
    "egress" in staging_services.get("worker", {}).get("networks", []),
    "Staging worker needs the egress network for external email/object-storage calls",
)

# Production stack: images come from GHCR, the env file is an absolute host
# path, and CI validates this file. Cover the same posture as staging so a
# regression here cannot reach the release gate unnoticed.
production_services = production.get("services", {})
required_production = {
    "postgres",
    "redis",
    "minio",
    "minio-init",
    "migrate",
    "api",
    "worker",
    "web",
    "admin",
}
for service in required_production:
    check(
        service in production_services,
        f"docker/compose.production.yml is missing {service}",
    )
for service in {"postgres", "redis", "minio"}:
    check(
        bool(production_services.get(service, {}).get("healthcheck")),
        f"Production {service} needs a healthcheck",
    )

production_networks = production.get("networks", {})
check(
    bool(production_networks.get("backend", {}).get("internal")),
    "The production backend network must be internal",
)
check("edge" in production_networks, "The production edge network is missing")
check("egress" in production_networks, "The production worker egress network is missing")
check(
    "egress" in production_services.get("worker", {}).get("networks", []),
    "Production worker needs the egress network",
)

for service in {"api", "worker", "web", "admin", "migrate"}:
    definition = production_services.get(service, {})
    check(definition.get("read_only") is True, f"Production {service} must use a read-only root FS")
    check("ALL" in definition.get("cap_drop", []), f"Production {service} must drop all capabilities")
    check(
        "no-new-privileges:true" in definition.get("security_opt", []),
        f"Production {service} must set no-new-privileges",
    )
    check(
        definition.get("env_file") == ["/opt/roamlog/config/.env.production"],
        f"Production {service} must load /opt/roamlog/config/.env.production",
    )
for service in {"postgres", "redis"}:
    check(
        not production_services.get(service, {}).get("ports"),
        f"Production {service} must stay private",
    )
for service in {"api", "web", "admin", "minio"}:
    for port in production_services.get(service, {}).get("ports", []):
        check(
            str(port).startswith("127.0.0.1:"),
            f"Production {service} port must bind loopback only",
        )

production_api = production_services.get("api", {})
check(
    production_api.get("depends_on", {}).get("migrate", {}).get("condition")
    == "service_completed_successfully",
    "Production API must wait for the migration job",
)
check(
    "${S3_PUBLIC_ENDPOINT:?" in str(production_api.get("environment", {}).get("S3_PUBLIC_ENDPOINT", "")),
    "Production API must keep the required S3_PUBLIC_ENDPOINT guard",
)

production_env = parse_env("docker/production.env.example")
check(production_env.get("APP_ENV") == "production", "Production template APP_ENV must be production")
interpolated_production_required = set(
    re.findall(r"\$\{([A-Z0-9_]+):\?", read("docker/compose.production.yml"))
)
missing_production_interpolation = sorted(interpolated_production_required - production_env.keys())
check(
    not missing_production_interpolation,
    "docker/production.env.example is missing compose interpolation keys: "
    + ", ".join(missing_production_interpolation),
)

for relative_path in (
    "docker/compose.yml",
    "docker/compose.staging.yml",
    "docker/compose.production.yml",
):
    text = read(relative_path)
    check("privileged: true" not in text, f"{relative_path} must not use privileged containers")
    check("network_mode: host" not in text, f"{relative_path} must not use host networking")
    check("/var/run/docker.sock" not in text, f"{relative_path} must not mount the Docker socket")
    for image in re.findall(r"^\s+image:\s+([^\s#]+)", text, flags=re.MULTILINE):
        check(not image.endswith(":latest"), f"{relative_path} uses a mutable latest tag: {image}")

# Templates must cover API configuration, app builds, and compose interpolation.
root_env_required = {
    "NODE_ENV",
    "LOG_LEVEL",
    "APP_URL",
    "ADMIN_URL",
    "API_URL",
    "BETTER_AUTH_URL",
    "CORS_ORIGINS",
    "DATABASE_URL",
    "REDIS_URL",
    "REDIS_PREFIX",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_REGION",
    "SMTP_HOST",
    "SMTP_PORT",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "SENTRY_DSN",
    "SENTRY_TRACES_SAMPLE_RATE",
    "NEXT_PUBLIC_MAP_STYLE_URL",
    "NEXT_PUBLIC_GEOCODER_URL",
    "EXPORT_SIGNED_URL_TTL",
    "BOOTSTRAP_SUPER_ADMIN_EMAIL",
    "BOOTSTRAP_SUPER_ADMIN_NAME",
}
require_env_keys(".env.example", root_env_required)

staging_env_required = root_env_required | {
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "REDIS_PASSWORD",
    "SESSION_COOKIE_DOMAIN",
    "TRUST_PROXY",
    "ADMIN_2FA_ENFORCED",
    "MINIO_IMAGE",
    "MINIO_MC_IMAGE",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "S3_FORCE_PATH_STYLE",
    "NEXT_PUBLIC_DATA_MODE",
    "NEXT_PUBLIC_ADMIN_DATA_MODE",
    "ROAMLOG_IMAGE_TAG",
}
require_env_keys("docker/staging.env.example", staging_env_required)

staging_env = parse_env("docker/staging.env.example")
check(staging_env.get("NODE_ENV") == "production", "Staging NODE_ENV must be production")
check(
    staging_env.get("DEMO_SEED_ENABLED") == "false",
    "Staging template must not enable demo seed by default",
)
for key in ("APP_URL", "ADMIN_URL", "API_URL"):
    check(
        staging_env.get(key, "").startswith("https://"),
        f"Staging {key} must use HTTPS",
    )
check(
    "app.staging" in staging_env.get("CORS_ORIGINS", "")
    and "admin.staging" in staging_env.get("CORS_ORIGINS", ""),
    "Staging CORS_ORIGINS must list the exact web and admin origins",
)

interpolated_required = set(
    re.findall(r"\$\{([A-Z0-9_]+):\?", read("docker/compose.staging.yml"))
)
missing_interpolation = sorted(interpolated_required - staging_env.keys())
check(
    not missing_interpolation,
    "docker/staging.env.example is missing compose interpolation keys: "
    + ", ".join(missing_interpolation),
)

# Production images must be multi-stage, non-root, and self-health-checking.
for relative_path in (
    "docker/api.Dockerfile",
    "docker/worker.Dockerfile",
    "docker/web.Dockerfile",
    "docker/admin.Dockerfile",
):
    text = read(relative_path)
    check(
        re.search(r"^USER (?:roamlog:roamlog|10001:10001)$", text, flags=re.MULTILINE) is not None,
        f"{relative_path} must run as a non-root user",
    )
    check("HEALTHCHECK" in text, f"{relative_path} must define a healthcheck")
    check("CMD " in text, f"{relative_path} must define a CMD")
    check(":latest" not in text, f"{relative_path} must not use a latest base image")
    check(
        "/workspace/tsconfig.base.json /tsconfig.base.json" in text,
        f"{relative_path} must preserve the monorepo tsconfig base expected by deployed packages",
    )
    ignore_path = relative_path.replace(".Dockerfile", ".Dockerfile.dockerignore")
    ignore_text = read(ignore_path)
    check("**/node_modules" in ignore_text, f"{ignore_path} must exclude node_modules")
    check("**/.env.*" in ignore_text, f"{ignore_path} must exclude environment files")

for relative_path in ("docker/web.Dockerfile", "docker/admin.Dockerfile"):
    text = read(relative_path)
    check(
        "pnpm --filter @roamlog/" in text and " deploy --prod --ignore-scripts" in text,
        f"{relative_path} must deploy production dependencies",
    )

check(
    "tsx@4.23.15" in read("docker/api.Dockerfile"),
    "API image must include the pinned tsx runtime loader",
)
check(
    "tsx@4.23.15" in read("docker/worker.Dockerfile"),
    "Worker image must include the pinned tsx runtime loader",
)
check(
    "prisma@7.10.1" in read("docker/api.Dockerfile"),
    "API migration target must include the pinned Prisma CLI",
)
check(
    (ROOT / "docker/Caddyfile.staging.example").exists(),
    "Staging ingress header example is missing",
)

# Workflow coverage and explicit dry-run behavior.
ci_text = read(".github/workflows/ci.yml")
for command in (
    "pnpm install --frozen-lockfile",
    "pnpm staging:validate",
    "docker compose",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm contracts:check",
    "pnpm build",
    "pnpm e2e:web",
    "pnpm e2e:api",
):
    check(command in ci_text, f"CI is missing required command: {command}")
check(bool(ci.get("jobs", {}).get("quality")), "CI quality job is missing")
check(
    "Production compose config validation" in ci_text,
    "CI is missing the production compose config validation step",
)
check(
    "sudo install -m 600" in ci_text and "/opt/roamlog/config/.env.production" in ci_text,
    "CI must stage docker/production.env.example at the compose env_file path before validation",
)

release_text = read(".github/workflows/release.yml")
check("workflow_dispatch" in release_text, "Release workflow needs a manual dry-run trigger")
check("dry_run" in release_text, "Release workflow needs a dry_run input")
check("uses: ./.github/workflows/ci.yml" in release_text, "Release must reuse the CI quality gate")
check("docker/build-push-action" in release_text, "Release does not build production images")
check("load:" in release_text and "push:" in release_text, "Release must separate dry-run and publish")
check(bool(release.get("jobs", {}).get("images")), "Release image job is missing")
check(
    "NEXT_PUBLIC_APP_ENV=" in release_text,
    "Release images must pass NEXT_PUBLIC_APP_ENV so staging builds do not show the PRODUCTION badge",
)

# Shell scripts must parse before they are copied into a container.
bash = shutil.which("bash")
if bash:
    for relative_path in sorted((ROOT / "docker").rglob("*.sh")):
        result = subprocess.run(
            [bash, "-n", str(relative_path)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        check(
            result.returncode == 0,
            f"Shell syntax error in {relative_path.relative_to(ROOT)}: {result.stderr.strip()}",
        )
else:
    warnings.append("bash is unavailable; shell syntax checks were skipped")

for warning in warnings:
    print(f"WARN: {warning}")

if errors:
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    raise SystemExit(1)

print(
    "Staging static checks passed: compose YAML, environment templates, Dockerfiles, "
    "workflow gate, and shell syntax."
)
