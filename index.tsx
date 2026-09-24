/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Jalolek and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addMessagePreSendListener, type MessageSendListener,removeMessagePreSendListener } from "@api/MessageEvents";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { findByPropsLazy, findCssClassesLazy } from "@webpack";
import { ChannelRouter, ConfirmModal, createRoot, FluxDispatcher, openModal, SelectedChannelStore } from "@webpack/common";

import { channelLabel, gatedForRow, shouldConfirmSend, shouldConfirmView, shouldConfirmVoice } from "./gates";
import { settings } from "./settings";

const cl = classNameFactory("vc-htb-");
const ChannelListClasses = findCssClassesLazy("icon");
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

function WarningBody({ children }: { children: React.ReactNode }) {
    return <div className={cl("warnbox")}>{children}</div>;
}

interface GateOptions {
    key: string;
    title: string;
    confirmText: string;
    body: React.ReactNode;
    onOk(): void;
    onKo?(): void;
}

const pendingGateKeys = new Set<string>();

/**
 * Returns true when the modal opened (or is already open), false when it could not be shown.
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

interface PrevChannel {
    guildId: string | null;
    channelId: string | null;
}

let lastChannel: PrevChannel = { guildId: null, channelId: null };
let booted = false;

const armedView = new Map<string, number>();

function armView(id: string) {
    armedView.set(id, Date.now());
}

function isArmedView(id: string): boolean {
    const at = armedView.get(id);
    if (at == null) return false;
    armedView.delete(id);
    return Date.now() - at < 10000;
}

function pruneArmedView() {
    const now = Date.now();
    for (const [id, at] of armedView) {
        if (now - at > 10000) armedView.delete(id);
    }
}

let viewGate: { channelId: string } | null = null;

function navigateToChannel(channelId: string) {
    setTimeout(() => {
        try {
            ChannelRouter.transitionToChannel(channelId);
        } catch {
            // ignore navigation failures
        }
    }, 0);
}

// ---- Opaque, NSFW-style gate overlay covering the whole window ----

let overlayRoot: ReturnType<typeof createRoot> | null = null;
let overlayContainer: HTMLDivElement | null = null;

function lockMessages() {
    document.documentElement.classList.add("vc-htb-locked");
}

function unlockMessages() {
    document.documentElement.classList.remove("vc-htb-locked");
}

function hideOverlay() {
    overlayRoot?.unmount();
    overlayRoot = null;
    overlayContainer?.remove();
    overlayContainer = null;
    unlockMessages();
}

function showOverlay(content: React.ReactNode) {
    hideOverlay();
    lockMessages();
    overlayContainer = document.createElement("div");
    document.body.appendChild(overlayContainer);
    overlayRoot = createRoot(overlayContainer);
    overlayRoot.render(content);
}

function GateScreen({ label, onView, onCancel }: { label: string; onView(): void; onCancel(): void }) {
    return (
        <div className={cl("gate")}>
            <svg className={cl("gate-icon")} height="48" width="48" viewBox="0 0 24 24" aria-hidden={true} role="img">
                <path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2V9h2v5z" />
            </svg>
            <div className={cl("gate-title")}>View {label}?</div>
            <div className={cl("gate-sub")}>This channel needs confirmation before opening.</div>
            <div className={cl("row")}>
                <Button variant="dangerPrimary" onClick={onView}>
                    View Channel
                </Button>
                <Button variant="secondary" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}

function onChannelSelect(event: { guildId: string | null; channelId: string | null }) {
    try {
        const channelId = event?.channelId;
        if (typeof channelId !== "string") return;

        pruneArmedView();

        if (!booted) {
            booted = true;
            lastChannel = { guildId: event?.guildId ?? null, channelId };
            return;
        }

        // Quiet pass while navigating (after View or after reverting)
        if (isArmedView(channelId)) {
            lastChannel = { guildId: event?.guildId ?? null, channelId };
            return;
        }

        // User navigated elsewhere while a gate was up
        if (viewGate != null && viewGate.channelId !== channelId) {
            viewGate = null;
            hideOverlay();
        }

        if (!shouldConfirmView(channelId)) {
            lastChannel = { guildId: event?.guildId ?? null, channelId };
            return;
        }

        if (viewGate?.channelId === channelId) return;

        const prevChannelId = lastChannel.channelId ?? null;
        viewGate = { channelId };

        // Never open the gated channel itself; stay on the previous one
        if (prevChannelId != null && prevChannelId !== channelId) {
            armView(prevChannelId);
            navigateToChannel(prevChannelId);
        }

        const label = channelLabel(channelId);

        showOverlay(
            <GateScreen
                label={label}
                onView={() => {
                    if (viewGate?.channelId !== channelId) return;
                    viewGate = null;
                    hideOverlay();
                    armView(channelId);
                    navigateToChannel(channelId);
                }}
                onCancel={() => {
                    if (viewGate?.channelId === channelId) viewGate = null;
                    hideOverlay();
                    if (prevChannelId != null && prevChannelId !== channelId) {
                        armView(prevChannelId);
                        navigateToChannel(prevChannelId);
                    }
                }}
            />
        );
    } catch {
        viewGate = null;
        hideOverlay();
    }
}

// ---- Voice gating (modal based; cancelling leaves the voice channel) ----

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

        if (voiceArmedChannel === channelId) {
            voiceArmedChannel = null;
            return;
        }
        if (SelectedChannelStore.getVoiceChannelId() === channelId) return;
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

// ---- Send gate ----

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
        if (!settings.store.fullResetMigrated) {
            for (const [key, def] of Object.entries(settings.def)) {
                if (Object.hasOwn(def, "default")) {
                    (settings.store as any)[key] = (def as any).default;
                }
            }
            settings.store.fullResetMigrated = true;
        }

        lastChannel = {
            guildId: null,
            channelId: SelectedChannelStore.getChannelId() ?? null
        };

        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        this.preSend = addMessagePreSendListener(sendListener);
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        if (this.preSend) removeMessagePreSendListener(this.preSend);
        pendingGateKeys.clear();
        pendingSend = false;
        viewGate = null;
        currentVoiceModalChannel = null;
        hideOverlay();
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
