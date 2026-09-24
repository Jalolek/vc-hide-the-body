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
import { ChannelRouter, ConfirmModal, createRoot, FluxDispatcher, GuildStore, openModal, SelectedChannelStore, SelectedGuildStore } from "@webpack/common";

import { channelLabel, gatedForRow, getChannel, guildViewGated, isVoiceish, shouldConfirmSend, shouldConfirmView, shouldConfirmVoice } from "./gates";
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
        if (id && !channelBlocked(id)) return id;
    }
    return null;
}

// ---- Opaque, NSFW-style gate overlay ----
// "messages" covers just the message list of the current channel.
// "guild" covers the whole server (channel list, chat, members, input bar).

let overlayRoot: ReturnType<typeof createRoot> | null = null;
let overlayContainer: HTMLDivElement | null = null;
let overlayPositionTimer: number | null = null;
let overlayMode: "messages" | "guild" = "messages";

function lockMessages() {
    document.documentElement.classList.add("vc-htb-locked");
}

function unlockMessages() {
    document.documentElement.classList.remove("vc-htb-locked");
}

function guildAreaLeft(): number {
    const rail = document.querySelector<HTMLElement>('[class*="guilds_"]')
        ?? document.querySelector<HTMLElement>('[class*="guilds"]');
    if (rail) {
        const r = rail.getBoundingClientRect();
        if (r.width > 0 && r.right > 0) return r.right;
    }
    const sidebar = document.querySelector<HTMLElement>('[class*="sidebar_"]');
    if (sidebar) {
        const r = sidebar.getBoundingClientRect();
        if (r.width > 0) return r.left;
    }
    return 0;
}

function positionOverlay() {
    if (!overlayContainer) return;

    if (overlayMode === "guild") {
        const left = guildAreaLeft();
        overlayContainer.style.left = `${left}px`;
        overlayContainer.style.top = "0px";
        overlayContainer.style.width = `${Math.max(0, window.innerWidth - left)}px`;
        overlayContainer.style.height = `${window.innerHeight}px`;
        return;
    }

    const target = document.querySelector<HTMLElement>(`div.${MessagesClasses.messagesWrapper}`);
    if (!target) return;
    const t = target.getBoundingClientRect();
    let { left } = t, { top } = t, { right } = t, { bottom } = t;

    // Also cover the message input bar so it can't be seen or used behind the gate
    const composer = document.querySelector<HTMLElement>('[class*="channelTextArea"]');
    if (composer) {
        const c = composer.getBoundingClientRect();
        if (c.width > 0 && c.height > 0) {
            left = Math.min(left, c.left);
            top = Math.min(top, c.top);
            right = Math.max(right, c.right);
            bottom = Math.max(bottom, c.bottom);
        }
    }

    overlayContainer.style.left = `${left}px`;
    overlayContainer.style.top = `${top}px`;
    overlayContainer.style.width = `${right - left}px`;
    overlayContainer.style.height = `${bottom - top}px`;
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

function showOverlay(content: React.ReactNode, mode: "messages" | "guild" = "messages") {
    hideOverlay();
    lockMessages();
    // Drop focus so the composer can't be typed into or submitted behind the gate
    (document.activeElement as HTMLElement | null)?.blur?.();
    overlayMode = mode;
    overlayContainer = document.createElement("div");
    overlayContainer.className = cl("gate-wrap");
    document.body.appendChild(overlayContainer);
    overlayRoot = createRoot(overlayContainer);
    overlayRoot.render(content);
    positionOverlay();
    overlayPositionTimer = window.setInterval(positionOverlay, 250);
    window.addEventListener("resize", positionOverlay);
}

// True while a view/server gate overlay is covering the app
function gateOverlayActive(): boolean {
    return overlayContainer != null;
}

// Block Enter on the message editor while a gate is up so nothing is sent
function onDocumentKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.isComposing) return;
    if (!gateOverlayActive()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('[contenteditable="true"]')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
}

function GateScreen({ label, sub, confirmText = "View Channel", onView, onCancel }: { label: string; sub?: string; confirmText?: string; onView(): void; onCancel(): void; }) {
    return (
        <div className={cl("gate")}>
            <svg className={cl("gate-icon")} height="48" width="48" viewBox="0 0 24 24" aria-hidden={true} role="img">
                <path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2V9h2v5z" />
            </svg>
            <div className={cl("gate-title")}>View {label}?</div>
            <div className={cl("gate-sub")}>{sub ?? "This channel needs confirmation before opening."}</div>
            <div className={cl("row")}>
                <Button variant="dangerPrimary" onClick={onView}>
                    {confirmText}
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
        updateGuildGate();

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

        if (channelBlocked(channelId)) {
            // A whole-server gate covers every channel in it
            if (guildBlocksChannel(channelId)) {
                lastChannel = { guildId: event?.guildId ?? null, channelId };
                return;
            }
            if (viewGate?.channelId === channelId) return;
            // Fallback for navigation that did not come from a sidebar click
            // (keyboard, notifications, etc): bounce back to a safe channel.
            showViewGate(channelId, true);
            return;
        }

        lastChannel = { guildId: event?.guildId ?? null, channelId };
        safeChannel = { guildId: event?.guildId ?? null, channelId };
    } catch {
        viewGate = null;
        hideOverlay();
    }
}

// ---- Whole-guild gate ----

let guildGateId: string | null = null;
let guildArmedId: string | null = null;

function currentGuildId(): string | null {
    try {
        return SelectedGuildStore.getGuildId() ?? null;
    } catch {
        return null;
    }
}

function guildName(guildId: string): string {
    try {
        return GuildStore.getGuild(guildId)?.name ?? "this server";
    } catch {
        return "this server";
    }
}

function guildOfChannel(channelId: string): string | null {
    return getChannel(channelId)?.guild_id ?? null;
}

// True while a gated server is open but not yet confirmed by the user.
function guildBlocksChannel(channelId: string): boolean {
    const guildId = guildOfChannel(channelId);
    if (!guildId) return false;
    if (!settings.store.gatesEnabled || !guildViewGated(guildId)) return false;
    return guildArmedId !== guildId;
}

// Whether opening this channel should be gated, accounting for whole-server gating.
function channelBlocked(channelId: string): boolean {
    if (!settings.store.gatesEnabled) return false;
    const guildId = guildOfChannel(channelId);
    if (guildId != null && guildViewGated(guildId)) return guildArmedId !== guildId;
    return shouldConfirmView(channelId);
}

function showGuildGate(guildId: string) {
    showOverlay(
        <GateScreen
            label={guildName(guildId)}
            sub="This whole server is hidden until you confirm."
            confirmText="View Server"
            onView={() => {
                guildArmedId = guildId;
                guildGateId = null;
                hideOverlay();
            }}
            onCancel={() => {
                guildGateId = null;
                hideOverlay();
                const back = safeTarget();
                if (back != null) {
                    armView(back);
                    navigateToChannel(back);
                }
            }}
        />,
        "guild"
    );
}

// Keeps the whole-guild gate in sync with the currently selected server.
function updateGuildGate() {
    try {
        const guildId = currentGuildId();
        if (guildArmedId && guildArmedId !== guildId) guildArmedId = null;

        const shouldGate = settings.store.gatesEnabled
            && guildId != null
            && guildViewGated(guildId)
            && guildArmedId !== guildId;

        if (shouldGate) {
            if (guildGateId !== guildId || overlayMode !== "guild") {
                guildGateId = guildId;
                showGuildGate(guildId!);
            }
        } else if (guildGateId != null) {
            guildGateId = null;
            if (overlayMode === "guild") hideOverlay();
        }
    } catch {
        // ignore
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
        if (event.button !== 0) return;
        const target = event.target as HTMLElement | null;
        if (!target) return;

        // Never interfere with modals, menus, popouts or other layered UI
        // (channel settings, context menus, etc)
        if (target.closest('[role="dialog"], [aria-modal="true"], [role="menu"], [role="menuitem"], [class*="layer_"], [class*="popout"]')) return;

        const item = target.closest("[data-list-item-id]") as HTMLElement | null;
        if (!item) return;

        // Only actual channel-list entries in the left sidebar, not arbitrary
        // list items elsewhere in the app
        if (!item.closest('[class*="sidebar_"]')) return;
        const raw = item.getAttribute("data-list-item-id") ?? "";
        if (!raw.startsWith("channels___") && !raw.startsWith("private-channels-")) return;

        const match = raw.match(/(\d+)$/);
        if (!match) return;

        const channelId = match[1];
        if (isVoiceish(getChannel(channelId))) return;
        if (!channelBlocked(channelId)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (guildBlocksChannel(channelId)) {
            updateGuildGate();
            return;
        }

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
    // Never let a message go out while a view/server gate is covering the app
    if (gateOverlayActive()) return { cancel: true };
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
        document.addEventListener("keydown", onDocumentKeyDown, true);
        this.preSend = addMessagePreSendListener(sendListener);
        updateGuildGate();
        this.guildTimer = window.setInterval(updateGuildGate, 300);
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        document.removeEventListener("click", onDocumentClick, true);
        document.removeEventListener("keydown", onDocumentKeyDown, true);
        if (this.preSend) removeMessagePreSendListener(this.preSend);
        if (this.guildTimer != null) clearInterval(this.guildTimer);
        pendingGateKeys.clear();
        pendingSend = false;
        viewGate = null;
        safeChannel = null;
        guildGateId = null;
        guildArmedId = null;
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
