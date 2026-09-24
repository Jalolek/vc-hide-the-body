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
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { ConfirmModal, FluxDispatcher, openModal } from "@webpack/common";
import type { ReactNode } from "react";

import { channelLabel, gatedForRow, shouldConfirmSend, shouldConfirmView, shouldConfirmVoice } from "./gates";
import { settings } from "./settings";

const logger = new Logger("HideTheBody");

const cl = classNameFactory("vc-htb-");
const ChannelListClasses = findCssClassesLazy("icon");

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

/**
 * Returns true if the caller should block the action (modal is up or about to be).
 * Returns false when the modal could not be shown, so callers must NOT block.
 */
function showGate({ key, title, confirmText, body, onOk, onKo }: GateOptions): boolean {
    if (pendingGateKeys.has(key)) return true;

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

function replayDispatch(type: string, channelId: string, action: any) {
    armReplay(type, channelId, action);
    setTimeout(() => {
        try {
            void FluxDispatcher.dispatch(action);
        } catch (err) {
            logger.error("Failed to dispatch gated action", err);
        }
    }, 0);
}

// Allow the startup restore select/voice to pass once without gating
let booted = false;

function fluxInterceptor(action: any): boolean {
    try {
        if (action == null || typeof action !== "object") return true;

        const { type, channelId } = action;
        if (typeof channelId !== "string") return true;

        // Quiet pass for the action we re-dispatch after confirming
        if (replay != null && type === replay.type && channelId === replay.channelId) {
            replay = null;
            return true;
        }

        switch (type) {
            case "CHANNEL_SELECT": {
                if (!booted) {
                    booted = true;
                    return true;
                }
                if (!shouldConfirmView(channelId)) return true;

                const block = showGate({
                    key: `view:${channelId}`,
                    title: `View ${channelLabel(channelId)}?`,
                    confirmText: "View",
                    body: <Paragraph>This channel needs confirmation every time you open it.</Paragraph>,
                    onOk: () => replayDispatch(type, channelId, action)
                });
                return !block;
            }
            case "VOICE_CHANNEL_SELECT": {
                if (!booted) {
                    booted = true;
                    return true;
                }
                if (!shouldConfirmVoice(channelId)) return true;

                const block = showGate({
                    key: `voice:${channelId}`,
                    title: `Join ${channelLabel(channelId)}?`,
                    confirmText: "Join",
                    body: <Paragraph>This voice channel needs confirmation every time you join.</Paragraph>,
                    onOk: () => replayDispatch(type, channelId, action)
                });
                return !block;
            }
            default:
                return true;
        }
    } catch {
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

        const shown = showGate({
            key: `send:${channelId}`,
            title: `Send to ${channelLabel(channelId)}?`,
            confirmText: "Send",
            body: <Paragraph>This channel needs confirmation before sending.</Paragraph>,
            onOk: () => finish(false),
            onKo: () => finish(true)
        });

        if (!shown) finish(true);
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
        }
    ],

    start() {
        if (!settings.store.dmGateMigrated) {
            settings.store.confirmDms = false;
            settings.store.dmGateMigrated = true;
        }
        FluxDispatcher.addInterceptor(fluxInterceptor);
        this.preSend = addMessagePreSendListener(sendListener);
    },

    stop() {
        const interceptors = (FluxDispatcher as any)._interceptors ?? [];
        const index = interceptors.indexOf(fluxInterceptor);
        if (index !== -1) interceptors.splice(index, 1);
        if (this.preSend) removeMessagePreSendListener(this.preSend);
        pendingGateKeys.clear();
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

    WarningIcon
});
