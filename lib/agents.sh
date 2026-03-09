#!/usr/bin/env bash
# Agent management functions for TinyClaw
# Interactive functions (add, remove, custom provider add/remove) moved to src/cli/agent.ts

# AGENTS_DIR set after loading settings (uses workspace path)
AGENTS_DIR=""

# Ensure all agent workspaces have .agents/skills copied from SCRIPT_DIR
ensure_agent_skills_links() {
    local skills_src="$SCRIPT_DIR/.agents/skills"
    [ -d "$skills_src" ] || return 0

    local agents_dir="$WORKSPACE_PATH"
    [ -d "$agents_dir" ] || return 0

    local agent_ids
    agent_ids=$(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null) || return 0

    for agent_id in $agent_ids; do
        local agent_dir="$agents_dir/$agent_id"
        [ -d "$agent_dir" ] || continue

        # Migrate: replace old symlinks with real directories
        if [ -L "$agent_dir/.agents/skills" ]; then
            rm "$agent_dir/.agents/skills"
        fi
        if [ -L "$agent_dir/.claude/skills" ]; then
            rm "$agent_dir/.claude/skills"
        fi

        # Sync default skills into .agents/skills
        # - Overwrites skills that exist in source (keeps them up to date)
        # - Preserves agent-specific custom skills not in source
        mkdir -p "$agent_dir/.agents/skills"
        for skill_dir in "$skills_src"/*/; do
            [ -d "$skill_dir" ] || continue
            local skill_name
            skill_name="$(basename "$skill_dir")"
            # Always overwrite default skills with latest from source
            rm -rf "$agent_dir/.agents/skills/$skill_name"
            cp -r "$skill_dir" "$agent_dir/.agents/skills/$skill_name"
        done

        # Mirror .agents/skills into .claude/skills for Claude Code
        mkdir -p "$agent_dir/.claude/skills"
        cp -r "$agent_dir/.agents/skills/"* "$agent_dir/.claude/skills/" 2>/dev/null || true
    done
}

# List all configured agents
agent_list() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    local agents_count
    agents_count=$(jq -r '(.agents // {}) | length' "$SETTINGS_FILE" 2>/dev/null)

    if [ "$agents_count" = "0" ] || [ -z "$agents_count" ]; then
        echo -e "${YELLOW}No agents configured.${NC}"
        echo ""
        echo "Using default single-agent mode (from models section)."
        echo ""
        echo "Add an agent with:"
        echo -e "  ${GREEN}$0 agent add${NC}"
        return
    fi

    echo -e "${BLUE}Configured Agents${NC}"
    echo "================="
    echo ""

    jq -r '(.agents // {}) | to_entries[] | "\(.key)|\(.value.name)|\(.value.provider)|\(.value.model)|\(.value.working_directory)"' "$SETTINGS_FILE" 2>/dev/null | \
    while IFS='|' read -r id name provider model workdir; do
        echo -e "  ${GREEN}@${id}${NC} - ${name}"
        echo "    Provider:  ${provider}/${model}"
        echo "    Directory: ${workdir}"
        echo ""
    done

    echo "Usage: Send '@agent_id <message>' in any channel to route to a specific agent."
}

# Show details for a specific agent
agent_show() {
    local agent_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    echo -e "${BLUE}Agent: @${agent_id}${NC}"
    echo ""
    jq "(.agents // {}).\"${agent_id}\"" "$SETTINGS_FILE" 2>/dev/null
}

# Set provider and/or model for a specific agent
agent_provider() {
    local agent_id="$1"
    local provider_arg="$2"
    local model_arg=""

    # Parse optional --model flag
    if [ "$3" = "--model" ] && [ -n "$4" ]; then
        model_arg="$4"
    fi

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    if [ -z "$provider_arg" ]; then
        # Show current provider/model for this agent
        local cur_provider cur_model agent_name
        cur_provider=$(jq -r "(.agents // {}).\"${agent_id}\".provider // \"anthropic\"" "$SETTINGS_FILE" 2>/dev/null)
        cur_model=$(jq -r "(.agents // {}).\"${agent_id}\".model // empty" "$SETTINGS_FILE" 2>/dev/null)
        agent_name=$(jq -r "(.agents // {}).\"${agent_id}\".name // \"${agent_id}\"" "$SETTINGS_FILE" 2>/dev/null)
        echo -e "${BLUE}Agent: @${agent_id} (${agent_name})${NC}"
        echo -e "${BLUE}Provider: ${GREEN}${cur_provider}${NC}"
        if [ -n "$cur_model" ]; then
            echo -e "${BLUE}Model:    ${GREEN}${cur_model}${NC}"
        fi
        return
    fi

    local tmp_file="$SETTINGS_FILE.tmp"

    case "$provider_arg" in
        anthropic)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "anthropic" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Anthropic with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "anthropic"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Anthropic${NC}"
                echo ""
                echo "Use 'tinyclaw agent provider ${agent_id} anthropic --model {sonnet|opus}' to also set the model."
            fi
            ;;
        openai)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "openai" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to OpenAI with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "openai"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to OpenAI${NC}"
                echo ""
                echo "Use 'tinyclaw agent provider ${agent_id} openai --model {gpt-5.3-codex|gpt-5.2}' to also set the model."
            fi
            ;;
        custom:*)
            local custom_provider_value="$provider_arg"
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg prov "$custom_provider_value" --arg model "$model_arg" \
                    '.agents[$id].provider = $prov | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to custom provider '${custom_provider_value}' with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" --arg prov "$custom_provider_value" \
                    '.agents[$id].provider = $prov' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to custom provider '${custom_provider_value}'${NC}"
            fi
            ;;
        *)
            echo "Usage: tinyclaw agent provider <agent_id> {anthropic|openai|custom:<id>} [--model MODEL_NAME]"
            echo ""
            echo "Examples:"
            echo "  tinyclaw agent provider coder                                    # Show current provider/model"
            echo "  tinyclaw agent provider coder anthropic                           # Switch to Anthropic"
            echo "  tinyclaw agent provider coder openai                              # Switch to OpenAI"
            echo "  tinyclaw agent provider coder anthropic --model opus              # Switch to Anthropic Opus"
            echo "  tinyclaw agent provider coder openai --model gpt-5.3-codex        # Switch to OpenAI GPT-5.3 Codex"
            echo "  tinyclaw agent provider coder custom:my-proxy                     # Switch to custom provider"
            echo "  tinyclaw agent provider coder custom:my-proxy --model gpt-4o      # Switch with model override"
            exit 1
            ;;
    esac

    echo ""
    echo "Note: Changes take effect on next message. Restart is not required."
}

# Reset a specific agent's conversation
agent_reset() {
    local agent_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    # Load settings if not already loaded
    if [ -z "$AGENTS_DIR" ] || [ "$AGENTS_DIR" = "" ]; then
        load_settings
        AGENTS_DIR="$WORKSPACE_PATH"
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        return 1
    fi

    mkdir -p "$AGENTS_DIR/$agent_id"
    touch "$AGENTS_DIR/$agent_id/reset_flag"

    local agent_name
    agent_name=$(jq -r "(.agents // {}).\"${agent_id}\".name" "$SETTINGS_FILE" 2>/dev/null)

    echo -e "${GREEN}✓ Reset flag set for agent '${agent_id}' (${agent_name})${NC}"
    echo "  The next message to @${agent_id} will start a fresh conversation."
}

# Reset multiple agents' conversations
agent_reset_multiple() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    load_settings
    AGENTS_DIR="$WORKSPACE_PATH"

    local has_error=0
    local reset_count=0

    for agent_id in "$@"; do
        agent_reset "$agent_id"
        if [ $? -eq 0 ]; then
            reset_count=$((reset_count + 1))
        else
            has_error=1
        fi
    done

    echo ""
    if [ "$reset_count" -gt 0 ]; then
        echo -e "${GREEN}Reset ${reset_count} agent(s).${NC}"
    fi

    if [ "$has_error" -eq 1 ]; then
        exit 1
    fi
}

# ── Custom Provider Management ────────────────────────────────────────────────

# List all custom providers
custom_provider_list() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    local count
    count=$(jq -r '(.custom_providers // {}) | length' "$SETTINGS_FILE" 2>/dev/null)

    if [ "$count" = "0" ] || [ -z "$count" ]; then
        echo -e "${YELLOW}No custom providers configured.${NC}"
        echo ""
        echo "Add one with:"
        echo -e "  ${GREEN}$0 provider add${NC}"
        return
    fi

    echo -e "${BLUE}Custom Providers${NC}"
    echo "================"
    echo ""

    jq -r '(.custom_providers // {}) | to_entries[] | "\(.key)|\(.value.name)|\(.value.harness)|\(.value.base_url)|\(.value.model // "default")"' "$SETTINGS_FILE" 2>/dev/null | \
    while IFS='|' read -r id name harness base_url model; do
        echo -e "  ${GREEN}${id}${NC} - ${name}"
        echo "    Harness:  ${harness}"
        echo "    Base URL: ${base_url}"
        echo "    Model:    ${model}"
        echo ""
    done

    echo "Usage: Set an agent to use a custom provider with:"
    echo -e "  ${GREEN}tinyclaw agent provider <agent_id> custom:<provider_id>${NC}"
}
