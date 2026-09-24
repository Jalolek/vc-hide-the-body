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

import { channelLabel, gatedForRow, getChannel, isVoiceish, shouldConfirmSend, shouldConfirmView, shouldConfirmVoice } from "./gates";
import { settings } from "./settings";

const cl = classNameFactory("vc-htb-");
const ChannelListClasses = findCssClassesLazy("icon");
const MessagesClasses = findCssClassesLazy("messagesWrapper");
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
let viewGate: { channelId: string } | null = null;
let safeChannel: PrevChannel | null = null;

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

function navigateToChannel(channelId: string) {
    setTimeout(() => {
        try {
            ChannelRouter.transitionToChannel(channelId);
        } catch {
            // ignore navigation failures
        }
    }, 0);
}

// Last channel the user could be on without passing a gate. Never a gated
// channel, so Cancel/revert can't silently reveal gated content.
function safeTarget(): string | null {
    for (const id of [safeChannel?.channelId, lastChannel.channelId]) {
        if (id && !shouldConfirmView(id)) return id;
    }
    return null;
}

// ---- Opaque, NSFW-style gate overlay covering just the messages container ----

let overlayRoot: ReturnType<typeof createRoot> | null = null;
let overlayContainer: HTMLDivElement | null = null;
let overlayPositionTimer: number | null = null;

function lockMessages() {
    document.documentElement.classList.add("vc-htb-locked");
}

function unlockMessages() {
    document.documentElement.classList.remove("vc-htb-locked");
}

function positionOverlay() {
    if (!overlayContainer) return;
    const target = document.querySelector<HTMLElement>(`div.${MessagesClasses.messagesWrapper}`);
    if (!target) return;
    const r = target.getBoundingClientRect();
    overlayContainer.style.left = `${r.left}px`;
    overlayContainer.style.top = `${r.top}px`;
    overlayContainer.style.width = `${r.width}px`;
    overlayContainer.style.height = `${r.height}px`;
}

function hideOverlay() {
    if (overlayPositionTimer != null) {
        clearInterval(overlayPositionTimer);
        overlayPositionTimer = null;
    }
    window.removeEventListener("resize", positionOverlay);
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
    overlayContainer.className = cl("gate-wrap");
    document.body.appendChild(overlayContainer);
    overlayRoot = createRoot(overlayContainer);
    overlayRoot.render(content);
    positionOverlay();
    overlayPositionTimer = window.setInterval(positionOverlay, 250);
    window.addEventListener("resize", positionOverlay);
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
            safeChannel = { guildId: event?.guildId ?? null, channelId };
            return;
        }

        if (viewGate?.channelId === channelId) return;

        // Fallback for navigation that did not come from a sidebar click
        // (keyboard, notifications, etc): bounce back to a safe channel.
        showViewGate(channelId, true);
    } catch {
        viewGate = null;
        hideOverlay();
    }
}

// Show the view gate for a channel. When `revert` is set, the gated channel
// has already been navigated to, so we bounce back to the last safe channel.
// Sidebar clicks pass revert=false because the click is blocked up front.
function showViewGate(channelId: string, revert: boolean) {
    if (viewGate?.channelId === channelId) return;
    viewGate = { channelId };

    if (revert) {
        const back = safeTarget();
        if (back != null && back !== channelId) {
            armView(back);
            navigateToChannel(back);
        }
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
                // If we somehow ended up on another gated channel, move to safety
                const current = SelectedChannelStore.getChannelId();
                if (current && current !== channelId && shouldConfirmView(current)) {
                    const back = safeTarget();
                    if (back != null && back !== current) {
                        armView(back);
                        navigateToChannel(back);
                    }
                }
            }}
        />
    );
}

// Block sidebar clicks on gated channels before Discord's own handler runs, so
// the channel is never opened in the first place (no flash, no revert).
function onDocumentClick(event: MouseEvent) {
    try {
        const target = event.target as HTMLElement | null;
        const item = target?.closest?.("[data-list-item-id]") as HTMLElement | null;
        if (!item) return;

        const raw = item.getAttribute("data-list-item-id") ?? "";
        const match = raw.match(/(\d+)$/);
        if (!match) return;

        const channelId = match[1];
        if (isVoiceish(getChannel(channelId))) return;
        if (!shouldConfirmView(channelId)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        showViewGate(channelId, false);
    } catch {
        // ignore
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

        const current = SelectedChannelStore.getChannelId() ?? null;
        lastChannel = { guildId: null, channelId: current };
        safeChannel = current != null && !shouldConfirmView(current)
            ? { guildId: null, channelId: current }
            : null;

        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        document.addEventListener("click", onDocumentClick, true);
        this.preSend = addMessagePreSendListener(sendListener);
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        document.removeEventListener("click", onDocumentClick, true);
        if (this.preSend) removeMessagePreSendListener(this.preSend);
        pendingGateKeys.clear();
        pendingSend = false;
        viewGate = null;
        safeChannel = null;
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
