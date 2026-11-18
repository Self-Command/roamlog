/**
 * Minimal SMTP sink for local verification.
 *
 * Accepts plain SMTP on 127.0.0.1:1025, stores each message as .eml, and prints
 * any http(s) links it finds so verification / invitation URLs are copyable.
 * Local QA only — not part of the product.
 */
import { createServer } from "node:net";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.env.SMTP_SINK_PORT ?? "1025");
const HOST = process.env.SMTP_SINK_HOST ?? "127.0.0.1";
const OUT = resolve(process.cwd(), ".data/local-verify/mail");
mkdirSync(OUT, { recursive: true });

let counter = 0;

function decodeBody(raw) {
  // 1) remove quoted-printable soft line breaks, 2) decode =XX escapes,
  // 3) also try base64 parts. Order matters: soft breaks must go first.
  const withoutSoftBreaks = raw.replace(/=\r?\n/g, "");
  const decodedQp = withoutSoftBreaks.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  const chunks = [decodedQp];
  if (/Content-Transfer-Encoding:\s*base64/i.test(raw)) {
    for (const part of raw.split(/\r?\n\r?\n/)) {
      try {
        chunks.push(Buffer.from(part.replace(/[^A-Za-z0-9+/=]/g, ""), "base64").toString("utf8"));
      } catch {
        /* ignore non-base64 parts */
      }
    }
  }
  return chunks.join("\n");
}

function linksIn(text) {
  const found = new Set();
  const regex = /https?:\/\/[^\s"'<>)\]]+/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const url = match[0]
      .replace(/&amp;/g, "&")
      .replace(/[.,;:]+$/, "")
      .trim();
    if (/\/(invite|verify-email|reset-password)/.test(url)) found.add(url);
  }
  return [...found];
}

createServer((socket) => {
  let buffer = "";
  let inData = false;
  let data = "";
  let from = "";
  let to = "";

  socket.setEncoding("utf8");
  socket.write("220 local-verify-smtp ready\r\n");

  socket.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);

      if (inData) {
        if (line === ".") {
          inData = false;
          counter += 1;
          const name = `mail-${String(counter).padStart(3, "0")}.eml`;
          const text = decodeBody(data);
          writeFileSync(resolve(OUT, name), data, "utf8");
          const links = linksIn(text);
          const subjectMatch = data.match(/^Subject:\s*(.+)$/im);
          const subject = subjectMatch ? subjectMatch[1].trim() : "(none)";
          console.log(`\n[mail #${counter}] from=${from} to=${to} saved=${name}`);
          console.log(`  subject: ${subject}`);
          for (const link of links) console.log(`  link: ${link}`);
          if (links.length > 0) {
            appendFileSync(
              resolve(OUT, "links.txt"),
              [
                `# mail ${counter} -> ${to.replace(/^RCPT TO:\s*/i, "").replace(/[<>]/g, "")}`,
                `# subject: ${subject}`,
                ...links,
                "",
              ].join("\n"),
              "utf8",
            );
          }
          socket.write("250 2.0.0 OK queued\r\n");
          data = "";
        } else {
          data += `${line}\r\n`;
        }
        continue;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        socket.write("250-local-verify-smtp\r\n250-8BITMIME\r\n250-SMTPUTF8\r\n250 SIZE 33554432\r\n");
      } else if (upper.startsWith("MAIL FROM")) {
        from = line;
        socket.write("250 2.1.0 OK\r\n");
      } else if (upper.startsWith("RCPT TO")) {
        to = line;
        socket.write("250 2.1.5 OK\r\n");
      } else if (upper.startsWith("DATA")) {
        inData = true;
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (upper.startsWith("RSET")) {
        data = "";
        socket.write("250 2.0.0 OK\r\n");
      } else if (upper.startsWith("NOOP")) {
        socket.write("250 2.0.0 OK\r\n");
      } else if (upper.startsWith("QUIT")) {
        socket.write("221 2.0.0 Bye\r\n");
        socket.end();
      } else {
        socket.write("250 2.0.0 OK\r\n");
      }
    }
  });

  socket.on("error", () => undefined);
}).listen(PORT, HOST, () => {
  console.log(`local-verify SMTP sink listening on ${HOST}:${PORT}`);
  console.log(`messages -> ${OUT}`);
});