/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Jalolek and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addMessagePreSendListener, type MessageSendListener,removeMessagePreSendListener } from "@api/MessageEvents";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { findByPropsLazy, findCssClassesLazy } from "@webpack";
import { ChannelRouter, ConfirmModal, FluxDispatcher, openModal, SelectedChannelStore } from "@webpack/common";
import type { ReactNode } from "react";

import { channelLabel, gatedForRow, shouldConfirmSend, shouldConfirmView, shouldConfirmVoice } from "./gates";
import { settings } from "./settings";

const cl = classNameFactory("vc-htb-");
const ChannelListClasses = findCssClassesLazy("modeSelected", "modeMuted", "unread", "icon");
const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

const WarningIcon = ErrorBoundary.wrap(() => (
    <svg
        className={classes(ChannelListClasses.icon, cl("warnicon"))}
        height="18"
        width="20"
        viewBox="0 0 24 24"
        aria-hidden={true}
        role="img"
    >
        <path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2V9h2v5z" />
    </svg>
), { noop: true });

function WarningBody({ children }: { children: ReactNode }) {
    return <div className={cl("warnbox")}>{children}</div>;
}

interface GateOptions {
    key: string;
    title: string;
    confirmText: string;
    body: ReactNode;
    onOk(): void;
    onKo?(): void;
}

const pendingGateKeys = new Set<string>();

function showGate({ key, title, confirmText, body, onOk, onKo }: GateOptions): boolean {
    if (pendingGateKeys.has(key)) return false;
    pendingGateKeys.add(key);

    const settle = (ok: boolean) => {
        pendingGateKeys.delete(key);
        if (ok) onOk();
        else onKo?.();
    };

    try {
        openModal(modalProps => (
            <ConfirmModal
                {...modalProps}
                title={title}
                confirmText={confirmText}
                cancelText="Cancel"
                variant="critical-primary"
                onConfirm={() => settle(true)}
                onCancel={() => settle(false)}
                onCloseCallback={() => settle(false)}
            >
                <WarningBody>{body}</WarningBody>
            </ConfirmModal>
        ));
        return true;
    } catch {
        settle(false);
        return false;
    }
}

interface PrevChannel {
    guildId: string | null;
    channelId: string | null;
}

let lastChannel: PrevChannel = { guildId: null, channelId: null };
let viewArmedChannel: string | null = null;
let currentViewModalChannel: string | null = null;

function navigateToChannel(channelId: string) {
    try {
        ChannelRouter.transitionToChannel(channelId);
    } catch {
        // ignore
    }
}

function onChannelSelect(event: { guildId: string | null; channelId: string | null }) {
    try {
        const channelId = event?.channelId;
        if (typeof channelId !== "string") return;

        const prevChannelId = lastChannel.channelId;
        lastChannel = { guildId: event?.guildId ?? null, channelId };

        // Quiet pass after confirming or after a revert
        if (viewArmedChannel === channelId) {
            viewArmedChannel = null;
            return;
        }
        // A modal for this channel is already open
        if (currentViewModalChannel === channelId) return;
        if (!shouldConfirmView(channelId)) return;

        currentViewModalChannel = channelId;
        setTimeout(() => {
            showGate({
                key: `view:${channelId}`,
                title: `View ${channelLabel(channelId)}?`,
                confirmText: "View",
                body: <Paragraph>This channel needs confirmation every time you open it.</Paragraph>,
                onOk: () => {
                    if (currentViewModalChannel === channelId) currentViewModalChannel = null;
                },
                onKo: () => {
                    if (currentViewModalChannel === channelId) currentViewModalChannel = null;
                    if (prevChannelId != null && prevChannelId !== channelId) {
                        viewArmedChannel = prevChannelId;
                        navigateToChannel(prevChannelId);
                    }
                }
            });
        }, 0);
    } catch {
        currentViewModalChannel = null;
    }
}

let voiceArmedChannel: string | null = null;
let currentVoiceModalChannel: string | null = null;

function leaveVoice() {
    try {
        void VoiceActions.selectVoiceChannel(null);
    } catch {
        // ignore
    }
}

function onVoiceChannelSelect(event: { channelId: string | null }) {
    try {
        const channelId = event?.channelId;
        if (typeof channelId !== "string") return;

        // Quiet pass after confirming via the channel row click
        if (voiceArmedChannel === channelId) {
            voiceArmedChannel = null;
            return;
        }
        // Already connected to this channel, treat as reconnect
        if (channelId === SelectedChannelStore.getVoiceChannelId()) return;
        if (currentVoiceModalChannel === channelId) return;
        if (!shouldConfirmVoice(channelId)) return;

        currentVoiceModalChannel = channelId;
        setTimeout(() => {
            showGate({
                key: `voice:${channelId}`,
                title: `Join ${channelLabel(channelId)}?`,
                confirmText: "Join",
                body: <Paragraph>This voice channel needs confirmation every time you join.</Paragraph>,
                onOk: () => {
                    if (currentVoiceModalChannel === channelId) currentVoiceModalChannel = null;
                },
                onKo: () => {
                    if (currentVoiceModalChannel === channelId) currentVoiceModalChannel = null;
                    leaveVoice();
                }
            });
        }, 0);
    } catch {
        currentVoiceModalChannel = null;
    }
}

let pendingSend = false;

const sendListener: MessageSendListener = (channelId, _message, _options, _props) => {
    if (!shouldConfirmSend(channelId)) return;
    if (pendingSend) return { cancel: true };
    pendingSend = true;

    return new Promise<{ cancel: boolean }>(resolve => {
        const finish = (cancel: boolean) => {
            pendingSend = false;
            resolve({ cancel });
        };

        showGate({
            key: `send:${channelId}`,
            title: `Send to ${channelLabel(channelId)}?`,
            confirmText: "Send",
            body: <Paragraph>This channel needs confirmation before sending.</Paragraph>,
            onOk: () => finish(false),
            onKo: () => finish(true)
        });
    });
};

export default definePlugin({
    name: "HideTheBody",
    description: "Confirm before viewing gated channels, joining voice, starting calls or sending messages.",
    authors: [{ name: "Jalolek", id: 1156907087431991306n }],
    tags: ["Servers", "Voice"],
    settings,

    patches: [
        {
            find: "#{intl::CHANNEL_TOOLTIP_DIRECTORY}",
            replacement: {
                match: /(?<=(\i)\.isNSFW\(\);)switch\(\i\.type\).{0,15}\.GUILD_ANNOUNCEMENT/,
                replace: (m, channel) => `if($self.isGatedRow(${channel}))return $self.WarningIcon;${m}`
            }
        },
        {
            find: "UNREAD_IMPORTANT:",
            replacement: {
                match: /Children\.count.+?;(?=return\(0,\i\.jsxs?\)\(\i\.\i,{focusTarget:)(?<={channel:(\i),name:\i,muted:(\i).+?;)/,
                replace: (m, channel, muted) => `${m}${muted}=$self.isGatedRow(${channel})?true:${muted};`
            }
        },
        {
            find: ".handleClickChat",
            replacement: [
                {
                    match: /onClick:\(\)=>\{this\.handleClick\(\)/g,
                    replace: "onClick:()=>{$self.gateVoiceClick(this,()=>{this.handleClick()})"
                }
            ]
        }
    ],

    start() {
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        this.preSend = addMessagePreSendListener(sendListener);
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        if (this.preSend) removeMessagePreSendListener(this.preSend);
        pendingGateKeys.clear();
        currentViewModalChannel = null;
        currentVoiceModalChannel = null;
    },

    isGatedRow(channel: any): boolean {
        try {
            const id = channel?.channelId ?? channel?.id;
            return typeof id === "string" ? gatedForRow(id) : false;
        } catch {
            return false;
        }
    },

    gateVoiceClick(row: any, proceed: () => void) {
        try {
            const channelId = row?.props?.channel?.id;
            if (typeof channelId !== "string") return void proceed();
            if (SelectedChannelStore.getVoiceChannelId() === channelId) return void proceed();
            if (!shouldConfirmVoice(channelId)) return void proceed();

            const shown = showGate({
                key: `voice:${channelId}`,
                title: `Join ${channelLabel(channelId)}?`,
                confirmText: "Join",
                body: <Paragraph>This voice channel needs confirmation every time you join.</Paragraph>,
                onOk: () => {
                    voiceArmedChannel = channelId;
                    proceed();
                },
                onKo: () => {
                    // stay in the current channel
                }
            });
            if (!shown) proceed();
        } catch {
            proceed();
        }
    },

    WarningIcon
});
