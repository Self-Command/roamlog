import type { SeedDataset } from "./types.js";
import {
  dateOnly,
  dateTime,
  json,
  nullableDateTime,
  type SeedTransaction,
} from "./apply-utils.js";

export async function applyIdentityAndTrips(
  tx: SeedTransaction,
  data: SeedDataset,
): Promise<void> {
  for (const user of data.users) {
    await tx.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.image,
        platformRole: user.platformRole,
        status: user.status,
        locale: user.locale,
        timezone: user.timezone,
        lastActiveAt: dateTime(user.lastActiveAt),
        createdAt: dateTime(user.createdAt),
        updatedAt: dateTime(user.updatedAt),
      },
      create: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.image,
        platformRole: user.platformRole,
        status: user.status,
        locale: user.locale,
        timezone: user.timezone,
        lastActiveAt: dateTime(user.lastActiveAt),
        createdAt: dateTime(user.createdAt),
        updatedAt: dateTime(user.updatedAt),
      },
    });
  }

  await tx.workspace.upsert({
    where: { id: data.workspace.id },
    update: {
      name: data.workspace.name,
      slug: data.workspace.slug,
      logoMediaId: null,
      ownerId: data.workspace.ownerId,
      plan: data.workspace.plan,
      status: data.workspace.status,
      defaultCurrency: data.workspace.defaultCurrency,
      timezone: data.workspace.timezone,
      weekStartsOn: data.workspace.weekStartsOn,
      settings: json(data.workspace.settings),
      createdAt: dateTime(data.workspace.createdAt),
      updatedAt: dateTime(data.workspace.updatedAt),
    },
    create: {
      id: data.workspace.id,
      name: data.workspace.name,
      slug: data.workspace.slug,
      logoMediaId: null,
      ownerId: data.workspace.ownerId,
      plan: data.workspace.plan,
      status: data.workspace.status,
      defaultCurrency: data.workspace.defaultCurrency,
      timezone: data.workspace.timezone,
      weekStartsOn: data.workspace.weekStartsOn,
      settings: json(data.workspace.settings),
      createdAt: dateTime(data.workspace.createdAt),
      updatedAt: dateTime(data.workspace.updatedAt),
    },
  });

  for (const member of data.members) {
    await tx.workspaceMember.upsert({
      where: { id: member.id },
      update: {
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role,
        status: member.status,
        joinedAt: dateTime(member.joinedAt),
        invitedById: member.invitedById,
        createdAt: dateTime(member.createdAt),
        updatedAt: dateTime(member.updatedAt),
      },
      create: {
        id: member.id,
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role,
        status: member.status,
        joinedAt: dateTime(member.joinedAt),
        invitedById: member.invitedById,
        createdAt: dateTime(member.createdAt),
        updatedAt: dateTime(member.updatedAt),
      },
    });
  }

  for (const invitation of data.invitations) {
    await tx.invitation.upsert({
      where: { id: invitation.id },
      update: {
        workspaceId: invitation.workspaceId,
        email: invitation.email,
        role: invitation.role,
        tokenHash: invitation.tokenHash,
        invitedById: invitation.invitedById,
        expiresAt: dateTime(invitation.expiresAt),
        acceptedAt: nullableDateTime(invitation.acceptedAt),
        revokedAt: nullableDateTime(invitation.revokedAt),
        createdAt: dateTime(invitation.createdAt),
      },
      create: {
        id: invitation.id,
        workspaceId: invitation.workspaceId,
        email: invitation.email,
        role: invitation.role,
        tokenHash: invitation.tokenHash,
        invitedById: invitation.invitedById,
        expiresAt: dateTime(invitation.expiresAt),
        acceptedAt: nullableDateTime(invitation.acceptedAt),
        revokedAt: nullableDateTime(invitation.revokedAt),
        createdAt: dateTime(invitation.createdAt),
      },
    });
  }

  for (const trip of data.trips) {
    await tx.trip.upsert({
      where: { id: trip.id },
      update: {
        workspaceId: trip.workspaceId,
        title: trip.title,
        summary: trip.summary,
        status: trip.status,
        startDate: dateOnly(trip.startDate),
        endDate: dateOnly(trip.endDate),
        coverMediaId: null,
        origin: trip.origin,
        destinations: trip.destinations,
        countryCodes: trip.countryCodes,
        tags: trip.tags,
        guestNames: trip.guestNames,
        budgetAmountMinor: trip.budgetAmountMinor,
        budgetCurrency: trip.budgetCurrency,
        visibility: trip.visibility,
        favorite: trip.favorite,
        version: trip.version,
        createdById: trip.createdById,
        updatedById: trip.updatedById,
        createdAt: dateTime(trip.createdAt),
        updatedAt: dateTime(trip.updatedAt),
        deletedAt: nullableDateTime(trip.deletedAt),
      },
      create: {
        id: trip.id,
        workspaceId: trip.workspaceId,
        title: trip.title,
        summary: trip.summary,
        status: trip.status,
        startDate: dateOnly(trip.startDate),
        endDate: dateOnly(trip.endDate),
        coverMediaId: null,
        origin: trip.origin,
        destinations: trip.destinations,
        countryCodes: trip.countryCodes,
        tags: trip.tags,
        guestNames: trip.guestNames,
        budgetAmountMinor: trip.budgetAmountMinor,
        budgetCurrency: trip.budgetCurrency,
        visibility: trip.visibility,
        favorite: trip.favorite,
        version: trip.version,
        createdById: trip.createdById,
        updatedById: trip.updatedById,
        createdAt: dateTime(trip.createdAt),
        updatedAt: dateTime(trip.updatedAt),
        deletedAt: nullableDateTime(trip.deletedAt),
      },
    });
  }

  for (const participant of data.tripParticipants) {
    await tx.tripParticipant.upsert({
      where: { id: participant.id },
      update: {
        workspaceId: participant.workspaceId,
        tripId: participant.tripId,
        userId: participant.userId,
        joinedAt: dateTime(participant.joinedAt),
      },
      create: {
        id: participant.id,
        workspaceId: participant.workspaceId,
        tripId: participant.tripId,
        userId: participant.userId,
        joinedAt: dateTime(participant.joinedAt),
      },
    });
  }

  for (const stop of data.stops) {
    await tx.stop.upsert({
      where: { id: stop.id },
      update: {
        workspaceId: stop.workspaceId,
        tripId: stop.tripId,
        city: stop.city,
        country: stop.country,
        countryCode: stop.countryCode,
        lat: stop.lat,
        lng: stop.lng,
        startDate: dateOnly(stop.startDate),
        endDate: dateOnly(stop.endDate),
        notes: stop.notes,
        order: stop.order,
        version: stop.version,
        createdById: stop.createdById,
        updatedById: stop.updatedById,
        createdAt: dateTime(stop.createdAt),
        updatedAt: dateTime(stop.updatedAt),
        deletedAt: nullableDateTime(stop.deletedAt),
      },
      create: {
        id: stop.id,
        workspaceId: stop.workspaceId,
        tripId: stop.tripId,
        city: stop.city,
        country: stop.country,
        countryCode: stop.countryCode,
        lat: stop.lat,
        lng: stop.lng,
        startDate: dateOnly(stop.startDate),
        endDate: dateOnly(stop.endDate),
        notes: stop.notes,
        order: stop.order,
        version: stop.version,
        createdById: stop.createdById,
        updatedById: stop.updatedById,
        createdAt: dateTime(stop.createdAt),
        updatedAt: dateTime(stop.updatedAt),
        deletedAt: nullableDateTime(stop.deletedAt),
      },
    });
  }
}
