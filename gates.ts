/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Jalolek and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { findStoreLazy } from "@webpack";
import { ChannelStore, UserStore } from "@webpack/common";

import { settings } from "./settings";

const SortedGuildStore = findStoreLazy("SortedGuildStore");

function parseList(raw: unknown): Set<string> {
    if (typeof raw !== "string") return new Set();
    return new Set(raw.split(/[\s,;\n]+/).filter(Boolean));
}

const parseCache = new Map<string, Set<string>>();

function toSet(raw: unknown): Set<string> {
    const key = typeof raw === "string" ? raw : "";
    let set = parseCache.get(key);
    if (!set) {
        set = parseList(key);
        parseCache.set(key, set);
    }
    return set;
}

export function getChannel(channelId: string): Channel | null {
    try {
        return ChannelStore.getChannel(channelId) ?? null;
    } catch {
        return null;
    }
}

export function isDMish(ch: Channel | null | undefined): boolean {
    if (!ch) return false;
    try {
        return ch.isDM() || ch.isGroupDM() || ch.isMultiUserDM();
    } catch {
        return ch.type === ChannelType.DM || ch.type === ChannelType.GROUP_DM;
    }
}

export function isVoiceish(ch: Channel | null | undefined): boolean {
    return ch?.type === ChannelType.GUILD_VOICE || ch?.type === ChannelType.GUILD_STAGE_VOICE;
}

export function getGuildFolderId(guildId: string | null | undefined): string | null {
    if (!guildId) return null;
    try {
        const folder = SortedGuildStore.getGuildFolders().find(f => f.guildIds?.includes(guildId));
        return folder?.folderId != null ? String(folder.folderId) : null;
    } catch {
        return null;
    }
}

function folderGated(guildId: string | null | undefined, raw: unknown): boolean {
    const folders = toSet(raw);
    if (folders.size === 0) return false;
    const folderId = getGuildFolderId(guildId);
    return folderId != null && folders.has(folderId);
}

function gatesOn(): boolean {
    return settings.store.gatesEnabled;
}

export function viewGated(channelId: string): boolean {
    const s = settings.store;
    if (!s.confirmView) return false;
    if (toSet(s.viewChannels).has(channelId)) return true;
    const ch = getChannel(channelId);
    if (!ch) return false;
    if (isDMish(ch)) return s.confirmDms;
    if (ch.guild_id != null) {
        if (toSet(s.viewGuilds).has(ch.guild_id)) return true;
        if (folderGated(ch.guild_id, s.viewFolders)) return true;
    }
    return false;
}

export function sendGated(channelId: string): boolean {
    const s = settings.store;
    // A channel gated for viewing is also gated for sending
    if (viewGated(channelId)) return true;
    if (!s.confirmSend) return false;
    if (toSet(s.sendChannels).has(channelId)) return true;
    const ch = getChannel(channelId);
    if (!ch) return false;
    if (isDMish(ch)) return s.confirmDms;
    if (ch.guild_id != null) {
        if (toSet(s.sendGuilds).has(ch.guild_id)) return true;
        if (folderGated(ch.guild_id, s.sendFolders)) return true;
    }
    return false;
}

export function shouldConfirmView(channelId: string): boolean {
    return gatesOn() && viewGated(channelId);
}

export function shouldConfirmSend(channelId: string): boolean {
    return gatesOn() && sendGated(channelId);
}

export function shouldConfirmVoice(channelId: string): boolean {
    if (!gatesOn()) return false;
    const ch = getChannel(channelId);
    if (!ch) return false;
    if (isDMish(ch)) return settings.store.confirmCalls;
    if (isVoiceish(ch)) return settings.store.confirmVoice || viewGated(channelId);
    return settings.store.confirmCalls;
}

export function gatedForRow(channelId: string): boolean {
    if (!gatesOn()) return false;
    const ch = getChannel(channelId);
    if (!ch || isDMish(ch)) return false;
    if (viewGated(channelId)) return true;
    if (isVoiceish(ch)) return settings.store.confirmVoice;
    return false;
}

export function channelLabel(channelId: string): string {
    const ch = getChannel(channelId);
    if (!ch) return "this channel";
    if (isDMish(ch)) {
        if (ch.name) return ch.name;
        const recipient = ch.recipients?.[0];
        if (recipient) {
            try {
                const user = UserStore.getUser(recipient);
                if (user) return user.globalName ?? user.username;
            } catch {
                // ignore
            }
        }
        return "DM";
    }
    return `#${ch.name ?? channelId}`;
}
