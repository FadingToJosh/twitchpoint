package web

import (
	"net/http"
	"strings"
	"time"

	"github.com/miwi/twitchpoint/internal/channels"
	"github.com/miwi/twitchpoint/internal/drops"
	"github.com/miwi/twitchpoint/internal/twitch"
)

// /api/streamdeck is a compact, read-only summary for glanceable clients
// (the Stream Deck plugin in streamdeck/). Everything a key needs is
// pre-computed here so the client never has to re-implement the selector's
// priority rules or the campaign maths. Field names are a contract with
// that plugin — rename them together. (local)

// StreamDeckSummary is the /api/streamdeck response.
type StreamDeckSummary struct {
	Version     string             `json:"version"`
	GeneratedAt time.Time          `json:"generated_at"`
	Watching    *StreamDeckChannel `json:"watching"`
	// AlsoWatching lists the other channels the points rotation is
	// currently watching (Twitch allows two concurrent watch slots).
	AlsoWatching []string        `json:"also_watching"`
	Drop         *StreamDeckDrop `json:"drop"`
	NextGame     *StreamDeckGame `json:"next_game"`
}

// StreamDeckChannel is the channel shown on the "Watching" key.
type StreamDeckChannel struct {
	Login        string `json:"login"`
	DisplayName  string `json:"display_name"`
	Game         string `json:"game"`
	IsDropTarget bool   `json:"is_drop_target"` // this is the channel farming the active drop
}

// StreamDeckDrop is the drop currently being farmed, plus its campaign.
type StreamDeckDrop struct {
	Campaign string `json:"campaign"`
	Game     string `json:"game"`
	Channel  string `json:"channel"`

	Name     string `json:"name"`
	Progress int    `json:"progress"`
	Required int    `json:"required"`
	Percent  int    `json:"percent"`

	Position int `json:"position"` // "drop 4 of 5"
	Total    int `json:"total"`
	Claimed  int `json:"claimed"`

	Next *drops.OutlookDrop `json:"next"`

	CampaignRemainingMinutes int       `json:"campaign_remaining_minutes"`
	CampaignEndsAt           time.Time `json:"campaign_ends_at"`
	FinishesAfterCampaignEnd bool      `json:"finishes_after_campaign_end"`
	Unreachable              int       `json:"unreachable"`
	// Estimated is false when the per-drop campaign data wasn't cached and
	// the numbers above come from the row alone (no next drop, ETA = this
	// drop only).
	Estimated bool `json:"estimated"`
}

// StreamDeckGame is the "next priority game" key.
type StreamDeckGame struct {
	Game     string `json:"game"`
	Campaign string `json:"campaign,omitempty"`
	// Source is "queue" when a queued campaign with a live channel exists
	// (this is what the farmer will switch to), or "wanted_games" when we
	// only know the next name in your priority list.
	Source string `json:"source"`
	Rank   int    `json:"rank"` // 1-based position in wanted_games, 0 if not listed
}

func (s *Server) handleStreamDeck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Plugins poll from another machine on the LAN; this endpoint is
	// read-only, so allowing any origin is harmless and saves a
	// browser-based client from a CORS wall.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-store")

	sum := buildStreamDeckSummary(
		s.farmer.GetActiveDrops(),
		s.farmer.GetChannels(),
		s.farmer.Config().GetGamesToWatch(),
		s.farmer.GetCampaign,
		time.Now(),
	)
	sum.Version = Version
	jsonResponse(w, sum)
}

func buildStreamDeckSummary(
	rows []drops.ActiveDrop,
	chans []channels.Snapshot,
	wanted []string,
	campaign func(id string) (twitch.DropCampaign, bool),
	now time.Time,
) StreamDeckSummary {
	sum := StreamDeckSummary{GeneratedAt: now.UTC(), AlsoWatching: []string{}}

	norm := func(g string) string { return strings.ToLower(strings.TrimSpace(g)) }
	rank := make(map[string]int, len(wanted))
	for i, g := range wanted {
		if _, dup := rank[norm(g)]; !dup {
			rank[norm(g)] = i + 1
		}
	}
	rankOf := func(g string) int { return rank[norm(g)] }

	// Active drop = first ACTIVE row (BuildRows orders by QueueIndex).
	var active *drops.ActiveDrop
	for i := range rows {
		if rows[i].Status == "ACTIVE" {
			active = &rows[i]
			break
		}
	}

	// Watching: the drop channel if it's being watched, else the first
	// watched channel (GetChannels sorts watching first).
	for _, ch := range chans {
		if !ch.IsWatching {
			continue
		}
		isTarget := active != nil && strings.EqualFold(ch.Login, active.ChannelLogin)
		c := &StreamDeckChannel{Login: ch.Login, DisplayName: ch.DisplayName, Game: ch.GameName, IsDropTarget: isTarget}
		if c.DisplayName == "" {
			c.DisplayName = ch.Login
		}
		switch {
		case sum.Watching == nil:
			sum.Watching = c
		case isTarget:
			sum.AlsoWatching = append(sum.AlsoWatching, sum.Watching.DisplayName)
			sum.Watching = c
		default:
			sum.AlsoWatching = append(sum.AlsoWatching, c.DisplayName)
		}
	}

	if active != nil {
		d := &StreamDeckDrop{
			Campaign:                 active.CampaignName,
			Game:                     active.GameName,
			Channel:                  active.ChannelLogin,
			Name:                     active.DropName,
			Progress:                 active.Progress,
			Required:                 active.Required,
			Percent:                  active.Percent,
			Claimed:                  active.ClaimedDrops,
			Total:                    active.WatchableDrops,
			CampaignRemainingMinutes: active.EtaMinutes,
			CampaignEndsAt:           active.EndAt,
		}
		d.Position = d.Claimed + 1
		if d.Position > d.Total {
			d.Position = d.Total
		}
		if c, ok := campaign(active.CampaignID); ok {
			o := drops.CampaignOutlook(c, active.DropID, active.Progress, now)
			d.Estimated = true
			d.Position, d.Total, d.Claimed = o.Position, o.Total, o.Claimed
			d.Next = o.Next
			d.CampaignRemainingMinutes = o.RemainingMinutes
			d.FinishesAfterCampaignEnd = o.FinishesAfterCampaignEnd
			d.Unreachable = o.Unreachable
			if o.Current != nil {
				d.Name = o.Current.Name
				d.Progress = o.Current.Progress
				d.Required = o.Current.Required
				if d.Required > 0 {
					d.Percent = min(100, d.Progress*100/d.Required)
				}
			}
		}
		sum.Drop = d
	}

	// Next game: best-ranked QUEUED campaign of a different game, using the
	// selector's order (wanted_games rank, then earliest end).
	curGame := ""
	if active != nil {
		curGame = norm(active.GameName)
	}
	var best *drops.ActiveDrop
	better := func(a, b *drops.ActiveDrop) bool {
		ra, rb := rankOf(a.GameName), rankOf(b.GameName)
		if ra == 0 {
			ra = len(wanted) + 1
		}
		if rb == 0 {
			rb = len(wanted) + 1
		}
		if ra != rb {
			return ra < rb
		}
		return a.EndAt.Before(b.EndAt)
	}
	for i := range rows {
		r := &rows[i]
		if r.Status != "QUEUED" || norm(r.GameName) == curGame {
			continue
		}
		if best == nil || better(r, best) {
			best = r
		}
	}
	if best != nil {
		sum.NextGame = &StreamDeckGame{Game: best.GameName, Campaign: best.CampaignName, Source: "queue", Rank: rankOf(best.GameName)}
	} else if len(wanted) > 0 {
		// Nothing farmable is queued: fall back to the next name in the
		// priority list after the current game (or the top of the list).
		start := 0
		if r := rankOf(curGame); r > 0 {
			start = r
		}
		for i := 0; i < len(wanted); i++ {
			g := wanted[(start+i)%len(wanted)]
			if norm(g) == curGame {
				continue
			}
			sum.NextGame = &StreamDeckGame{Game: g, Source: "wanted_games", Rank: rankOf(g)}
			break
		}
	}
	return sum
}
