/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Jalolek and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { ApplicationStreamingStore, ChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { settings } from "./settings";

function parseList(raw: string): Set<string> {
    return new Set(raw.split(/[\s,;\n]+/).filter(Boolean));
}

const parseCache = new Map<string, Set<string>>();

function toSet(raw: string): Set<string> {
    let set = parseCache.get(raw);
    if (!set) {
        set = parseList(raw);
        parseCache.set(raw, set);
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

export function inVoice(): boolean {
    try {
        const me = UserStore.getCurrentUser();
        if (!me) return false;
        return VoiceStateStore.getVoiceStateForUser(me.id)?.channelId != null;
    } catch {
        return false;
    }
}

export function streaming(): boolean {
    try {
        return ApplicationStreamingStore.getCurrentUserActiveStream() != null;
    } catch {
        return false;
    }
}

function bypassActive(): boolean {
    const s = settings.store;
    if (!s.bypassInVoice) return false;
    if (!inVoice()) return false;
    return !s.bypassOnlyStreaming || streaming();
}

function gatesOn(): boolean {
    return settings.store.enabled && !bypassActive();
}

export function viewGated(channelId: string): boolean {
    const s = settings.store;
    if (!s.confirmView) return false;
    const ch = getChannel(channelId);
    if (!ch) return false;
    if (isDMish(ch)) return s.confirmDms;
    if (toSet(s.viewChannels).has(channelId)) return true;
    return ch.guild_id != null && toSet(s.viewGuilds).has(ch.guild_id);
}

export function sendGated(channelId: string): boolean {
    const s = settings.store;
    if (!s.confirmSend) return false;
    const ch = getChannel(channelId);
    if (!ch) return false;
    if (isDMish(ch)) return s.confirmDms;
    if (toSet(s.sendChannels).has(channelId)) return true;
    return ch.guild_id != null && toSet(s.sendGuilds).has(ch.guild_id);
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
