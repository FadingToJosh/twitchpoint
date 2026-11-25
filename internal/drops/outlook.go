package drops

import (
	"math"
	"sort"
	"time"

	"github.com/miwi/twitchpoint/internal/twitch"
)

// OutlookDrop is one drop of a campaign as seen by CampaignOutlook.
type OutlookDrop struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Progress int    `json:"progress"` // minutes watched (live-adjusted)
	Required int    `json:"required"` // minutes required
	// FinishInMinutes is the estimated number of watch minutes from now
	// until this drop is earned, including any wait for its precondition
	// chain or its per-drop start time.
	FinishInMinutes int `json:"finish_in_minutes"`
}

// Outlook is the forward-looking view of one campaign: which drop is being
// earned now, which one comes after it, and how long until every
// watch-time drop in the campaign is earned.
type Outlook struct {
	Current *OutlookDrop `json:"current,omitempty"`
	Next    *OutlookDrop `json:"next,omitempty"`
	// Position / Total are "drop 4 of 5": Position = claimed + 1 (capped at
	// Total), Total = number of watch-time drops (sub-gated / reward-only
	// tiers are not counted, same rule as ActiveDrop.WatchableDrops).
	Position int `json:"position"`
	Total    int `json:"total"`
	Claimed  int `json:"claimed"`
	// RemainingMinutes is the estimated watch time until the last reachable
	// drop is earned. Twitch credits every un-gated drop of a campaign in
	// parallel, so this is NOT the sum of the gaps: it is the latest finish
	// time across drops, where a drop gated behind a precondition only
	// starts accruing once that precondition is earned.
	RemainingMinutes int `json:"remaining_minutes"`
	// Unreachable counts unclaimed drops that can't be earned by watching
	// (precondition is sub-gated, or the drop's window already closed).
	Unreachable int `json:"unreachable"`
	// FinishesAfterCampaignEnd is true when RemainingMinutes of continuous
	// watching would run past the campaign's end — i.e. you will not get
	// everything even if the farmer never switches away.
	FinishesAfterCampaignEnd bool `json:"finishes_after_campaign_end"`
}

// CampaignOutlook computes the Outlook for campaign c.
//
// Inventory data (c) is only refreshed once per drops cycle, while live
// progress for the drop currently being credited arrives over the
// websocket and lands on ActiveDrop.Progress. liveDropID / liveProgress
// carry that fresher number in: the difference to the cached value is
// applied to every un-gated drop, because Twitch credits those together.
// Pass liveDropID == "" to use the inventory numbers as-is.
func CampaignOutlook(c twitch.DropCampaign, liveDropID string, liveProgress int, now time.Time) Outlook {
	var out Outlook

	byID := make(map[string]twitch.TimeBasedDrop, len(c.Drops))
	for _, d := range c.Drops {
		byID[d.ID] = d
		if d.RequiredMinutesWatched <= 0 {
			continue
		}
		out.Total++
		if d.IsClaimed {
			out.Claimed++
		}
	}
	out.Position = out.Claimed + 1
	if out.Position > out.Total {
		out.Position = out.Total
	}

	gated := func(d twitch.TimeBasedDrop) bool {
		for _, pid := range d.PreconditionDrops {
			if p, ok := byID[pid]; ok && !p.IsClaimed {
				return true
			}
		}
		return false
	}

	// Live delta: how many minutes the websocket has credited since the
	// inventory snapshot was taken.
	delta := 0
	if liveDropID != "" {
		if d, ok := byID[liveDropID]; ok && liveProgress > d.CurrentMinutesWatched {
			delta = liveProgress - d.CurrentMinutesWatched
		}
	}

	const unreachable = math.MaxInt32
	memo := make(map[string]int)
	visiting := make(map[string]bool)
	var finish func(id string) int
	finish = func(id string) int {
		if v, ok := memo[id]; ok {
			return v
		}
		d, ok := byID[id]
		if !ok {
			return unreachable
		}
		if d.IsClaimed {
			return 0
		}
		if visiting[id] || d.RequiredMinutesWatched <= 0 || d.RequiredSubs > 0 {
			return unreachable
		}
		if !d.EndAt.IsZero() && !now.Before(d.EndAt) {
			memo[id] = unreachable
			return unreachable
		}
		visiting[id] = true
		defer delete(visiting, id)

		start := 0
		if !d.StartAt.IsZero() && now.Before(d.StartAt) {
			start = int(math.Ceil(d.StartAt.Sub(now).Minutes()))
		}
		for _, pid := range d.PreconditionDrops {
			pf := finish(pid)
			if pf == unreachable {
				memo[id] = unreachable
				return unreachable
			}
			if pf > start {
				start = pf
			}
		}
		progress := d.CurrentMinutesWatched
		if !gated(d) && start == 0 {
			progress += delta
		}
		left := d.RequiredMinutesWatched - progress
		if left < 0 {
			left = 0
		}
		v := start + left
		memo[id] = v
		return v
	}

	var open []OutlookDrop
	for _, d := range c.Drops {
		if d.RequiredMinutesWatched <= 0 || d.IsClaimed {
			continue
		}
		f := finish(d.ID)
		if f == unreachable {
			out.Unreachable++
			continue
		}
		name := d.BenefitName
		if name == "" {
			name = d.Name
		}
		progress := d.CurrentMinutesWatched
		if !gated(d) && (d.StartAt.IsZero() || !now.Before(d.StartAt)) {
			progress += delta
		}
		if progress > d.RequiredMinutesWatched {
			progress = d.RequiredMinutesWatched
		}
		open = append(open, OutlookDrop{
			ID:              d.ID,
			Name:            name,
			Progress:        progress,
			Required:        d.RequiredMinutesWatched,
			FinishInMinutes: f,
		})
		if f > out.RemainingMinutes {
			out.RemainingMinutes = f
		}
	}
	if len(open) == 0 {
		return out
	}

	sort.SliceStable(open, func(i, j int) bool {
		return open[i].FinishInMinutes < open[j].FinishInMinutes
	})

	// The drop being credited right now is the live one when we know it,
	// otherwise the one that will finish first.
	cur := 0
	if liveDropID != "" {
		for i := range open {
			if open[i].ID == liveDropID {
				cur = i
				break
			}
		}
	}
	c0 := open[cur]
	out.Current = &c0
	for i := range open {
		if i != cur && open[i].FinishInMinutes >= c0.FinishInMinutes {
			n := open[i]
			out.Next = &n
			break
		}
	}

	if !c.EndAt.IsZero() && now.Add(time.Duration(out.RemainingMinutes)*time.Minute).After(c.EndAt) {
		out.FinishesAfterCampaignEnd = true
	}
	return out
}
