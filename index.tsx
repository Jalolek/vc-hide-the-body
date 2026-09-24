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
import { findCssClassesLazy } from "@webpack";
import { ConfirmModal, FluxDispatcher, openModal, SelectedChannelStore } from "@webpack/common";
import type { ReactNode } from "react";

import { channelLabel, gatedForRow, shouldConfirmSend, shouldConfirmView, shouldConfirmVoice } from "./gates";
import { settings } from "./settings";

const cl = classNameFactory("vc-htb-");
const ChannelListClasses = findCssClassesLazy("modeSelected", "modeMuted", "unread", "icon");

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

let pendingGateKey: string | null = null;

function showGate({ key, title, confirmText, body, onOk, onKo }: GateOptions) {
    if (pendingGateKey === key) return;
    pendingGateKey = key;

    const settle = (ok: boolean) => {
        if (pendingGateKey === key) pendingGateKey = null;
        if (ok) onOk();
        else onKo?.();
    };

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
}

interface ReplayState {
    type: string;
    channelId: string;
    ref: unknown;
}

let replay: ReplayState | null = null;

function armReplay(type: string, channelId: string, ref: unknown) {
    replay = { type, channelId, ref };
    setTimeout(() => {
        if (replay?.ref === ref) replay = null;
    }, 5000);
}

function fluxInterceptor(action: any): boolean {
    if (action == null || typeof action !== "object") return true;

    if (replay != null && replay.type === action.type && replay.channelId === action.channelId) {
        replay = null;
        return true;
    }

    switch (action.type) {
        case "CHANNEL_SELECT": {
            const channelId = action.channelId as string | undefined;
            if (channelId == null) return true;
            if (!shouldConfirmView(channelId)) return true;

            showGate({
                key: `view:${channelId}`,
                title: `View ${channelLabel(channelId)}?`,
                confirmText: "View",
                body: <Paragraph>This channel needs confirmation every time you open it.</Paragraph>,
                onOk: () => {
                    armReplay(action.type, channelId, action);
                    void FluxDispatcher.dispatch(action);
                }
            });
            return false;
        }
        case "VOICE_CHANNEL_SELECT": {
            const channelId = action.channelId as string | undefined;
            if (channelId == null) return true;
            if (!shouldConfirmVoice(channelId)) return true;

            showGate({
                key: `voice:${channelId}`,
                title: `Join ${channelLabel(channelId)}?`,
                confirmText: "Join",
                body: <Paragraph>This voice channel needs confirmation every time you join.</Paragraph>,
                onOk: () => {
                    armReplay(action.type, channelId, action);
                    void FluxDispatcher.dispatch(action);
                }
            });
            return false;
        }
        default:
            return true;
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
        FluxDispatcher.addInterceptor(fluxInterceptor);
        this.preSend = addMessagePreSendListener(sendListener);
    },

    stop() {
        const interceptors = (FluxDispatcher as any)._interceptors ?? [];
        const index = interceptors.indexOf(fluxInterceptor);
        if (index !== -1) interceptors.splice(index, 1);
        if (this.preSend) removeMessagePreSendListener(this.preSend);
        pendingGateKey = null;
        pendingSend = false;
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

            showGate({
                key: `voice:${channelId}`,
                title: `Join ${channelLabel(channelId)}?`,
                confirmText: "Join",
                body: <Paragraph>This voice channel needs confirmation every time you join.</Paragraph>,
                onOk: () => {
                    armReplay("VOICE_CHANNEL_SELECT", channelId, {});
                    proceed();
                }
            });
        } catch {
            proceed();
        }
    },

    WarningIcon
});
