#!/usr/bin/env bash
# Team management functions for TinyClaw
# Interactive functions (add, remove, remove-agent) moved to src/cli/team.ts

# List all configured teams
team_list() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    local teams_count
    teams_count=$(jq -r '(.teams // {}) | length' "$SETTINGS_FILE" 2>/dev/null)

    if [ "$teams_count" = "0" ] || [ -z "$teams_count" ]; then
        echo -e "${YELLOW}No teams configured.${NC}"
        echo ""
        echo "Add a team with:"
        echo -e "  ${GREEN}$0 team add${NC}"
        return
    fi

    echo -e "${BLUE}Configured Teams${NC}"
    echo "================="
    echo ""

    jq -r '(.teams // {}) | to_entries[] | "\(.key)|\(.value.name)|\(.value.agents | join(","))|\(.value.leader_agent)"' "$SETTINGS_FILE" 2>/dev/null | \
    while IFS='|' read -r id name agents leader; do
        echo -e "  ${GREEN}@${id}${NC} - ${name}"
        echo "    Agents:  ${agents}"
        echo "    Leader:  @${leader}"
        echo ""
    done

    echo "Usage: Send '@team_id <message>' in any channel to route to a team."
}

# Show details for a specific team
team_show() {
    local team_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local team_json
    team_json=$(jq -r "(.teams // {}).\"${team_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$team_json" ]; then
        echo -e "${RED}Team '${team_id}' not found.${NC}"
        echo ""
        echo "Available teams:"
        jq -r '(.teams // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    echo -e "${BLUE}Team: @${team_id}${NC}"
    echo ""
    jq "(.teams // {}).\"${team_id}\"" "$SETTINGS_FILE" 2>/dev/null
}

# Add an existing agent to an existing team (non-interactive, args provided)
team_add_agent() {
    local team_id="$1"
    local agent_id="$2"

    if [ -z "$team_id" ] || [ -z "$agent_id" ]; then
        echo "Usage: $0 team add-agent <team_id> <agent_id>"
        exit 1
    fi

    team_id=$(echo "$team_id" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
    agent_id=$(echo "$agent_id" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local team_json
    team_json=$(jq -r "(.teams // {}).\"${team_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$team_json" ]; then
        echo -e "${RED}Team '${team_id}' not found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        exit 1
    fi

    local already_member
    already_member=$(jq -r --arg tid "$team_id" --arg aid "$agent_id" \
        'if ((.teams // {})[$tid].agents | index($aid)) then "yes" else "no" end' \
        "$SETTINGS_FILE" 2>/dev/null)
    if [ "$already_member" = "yes" ]; then
        echo -e "${YELLOW}Agent '${agent_id}' is already in team '${team_id}'.${NC}"
        return
    fi

    local tmp_file="$SETTINGS_FILE.tmp"
    jq --arg tid "$team_id" --arg aid "$agent_id" \
        '.teams[$tid].agents += [$aid]' \
        "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    local team_name
    team_name=$(jq -r "(.teams // {}).\"${team_id}\".name // \"${team_id}\"" "$SETTINGS_FILE" 2>/dev/null)

    echo -e "${GREEN}Added @${agent_id} to team '${team_id}' (${team_name}).${NC}"
}
