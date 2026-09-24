/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Jalolek and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { OptionType } from "@utils/types";
import { ChannelStore, SelectedChannelStore } from "@webpack/common";

function split(raw: string): Set<string> {
    return new Set(raw.split(/[\s,;\n]+/).filter(Boolean));
}

function addId(raw: string, id: string | null | undefined): string {
    if (!id || !/^\d+$/.test(id)) return raw;
    const set = split(raw);
    set.add(id);
    return [...set].join(", ");
}

function removeId(raw: string, id: string | null | undefined): string {
    if (!id) return raw;
    const set = split(raw);
    set.delete(id);
    return [...set].join(", ");
}

function GatePanel() {
    const view = settings.use(["viewChannels", "viewGuilds", "sendChannels"]);
    const channelId = SelectedChannelStore.getChannelId() ?? "";
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    const guildId = channel?.guild_id ?? null;
    const label = channelId ? (channel?.name ? `#${channel.name}` : channelId) : "no channel open";

    return (
        <div className="vc-htb-panel">
            <Paragraph>Quick controls for <b>{label}</b>.</Paragraph>
            <div className="vc-htb-row">
                <Button
                    size="small"
                    disabled={!channelId}
                    onClick={() => {
                        settings.store.viewChannels = addId(view.viewChannels, channelId);
                    }}
                >
                    Gate view
                </Button>
                <Button
                    size="small"
                    variant="secondary"
                    disabled={!guildId}
                    onClick={() => {
                        settings.store.viewGuilds = addId(view.viewGuilds, guildId);
                    }}
                >
                    Gate whole guild
                </Button>
                <Button
                    size="small"
                    variant="secondary"
                    disabled={!channelId}
                    onClick={() => {
                        settings.store.sendChannels = addId(view.sendChannels, channelId);
                    }}
                >
                    Gate sending
                </Button>
                <Button
                    size="small"
                    variant="dangerSecondary"
                    disabled={!channelId}
                    onClick={() => {
                        settings.store.viewChannels = removeId(view.viewChannels, channelId);
                        settings.store.sendChannels = removeId(view.sendChannels, channelId);
                    }}
                >
                    Remove channel
                </Button>
            </div>
            <Paragraph className="vc-htb-meta">
                viewChannels: {view.viewChannels || "empty"}<br />
                viewGuilds: {view.viewGuilds || "empty"}<br />
                sendChannels: {view.sendChannels || "empty"}
            </Paragraph>
        </div>
    );
}

export const settings = definePluginSettings({
    gatesEnabled: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Enable all gates"
    },
    confirmView: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Confirm before viewing gated channels"
    },
    viewChannels: {
        type: OptionType.STRING,
        default: "",
        multiline: true,
        placeholder: "Channel IDs, comma or newline separated",
        description: "Channels that need confirm before viewing"
    },
    viewGuilds: {
        type: OptionType.STRING,
        default: "",
        multiline: true,
        placeholder: "Guild IDs",
        description: "Guilds where every channel needs confirm before viewing"
    },
    confirmSend: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Confirm before sending messages in gated channels"
    },
    sendChannels: {
        type: OptionType.STRING,
        default: "",
        multiline: true,
        placeholder: "Channel IDs",
        description: "Channels that need confirm before sending"
    },
    sendGuilds: {
        type: OptionType.STRING,
        default: "",
        multiline: true,
        placeholder: "Guild IDs",
        description: "Guilds where every channel needs confirm before sending"
    },
    confirmDms: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Confirm before opening or sending in ALL DMs (specific DMs can still be gated by channel ID below)"
    },
    dmGateMigrated: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Internal: resets the legacy all-DMs default once"
    },
    confirmVoice: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Confirm before joining a voice channel"
    },
    confirmCalls: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Confirm before starting calls"
    },
    bypassInVoice: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Skip all gates while in a voice channel"
    },
    bypassOnlyStreaming: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Only skip gates while streaming in a voice channel"
    },
    quickPanel: {
        type: OptionType.COMPONENT,
        description: "Quick controls",
        component: () => <GatePanel />
    }
});
