package drops

import (
	"testing"
	"time"

	"github.com/miwi/twitchpoint/internal/twitch"
)

func TestCampaignOutlookParallelDrops(t *testing.T) {
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	c := twitch.DropCampaign{
		ID:    "c1",
		EndAt: now.Add(48 * time.Hour),
		Drops: []twitch.TimeBasedDrop{
			{ID: "d1", Name: "One", RequiredMinutesWatched: 60, CurrentMinutesWatched: 60, IsClaimed: true},
			{ID: "d2", Name: "Two", RequiredMinutesWatched: 120, CurrentMinutesWatched: 56},
			{ID: "d3", Name: "Three", RequiredMinutesWatched: 240, CurrentMinutesWatched: 56},
			{ID: "sub", Name: "Sub", RequiredMinutesWatched: 0, RequiredSubs: 1},
		},
	}
	o := CampaignOutlook(c, "", 0, now)
	if o.Position != 2 || o.Total != 3 || o.Claimed != 1 {
		t.Fatalf("position = %d/%d claimed %d, want 2/3 claimed 1", o.Position, o.Total, o.Claimed)
	}
	if o.Current == nil || o.Current.ID != "d2" || o.Current.Progress != 56 {
		t.Fatalf("current = %+v, want d2 at 56", o.Current)
	}
	if o.Next == nil || o.Next.ID != "d3" {
		t.Fatalf("next = %+v, want d3", o.Next)
	}
	// Parallel accrual: remaining is the longest gap (240-56), not the sum.
	if o.RemainingMinutes != 184 {
		t.Fatalf("remaining = %d, want 184", o.RemainingMinutes)
	}
	if o.FinishesAfterCampaignEnd {
		t.Fatal("should finish before campaign end")
	}
}

func TestCampaignOutlookPreconditionChain(t *testing.T) {
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	c := twitch.DropCampaign{
		ID:    "c2",
		EndAt: now.Add(2 * time.Hour),
		Drops: []twitch.TimeBasedDrop{
			{ID: "a", RequiredMinutesWatched: 60, CurrentMinutesWatched: 30},
			{ID: "b", RequiredMinutesWatched: 60, PreconditionDrops: []string{"a"}},
			{ID: "c", RequiredMinutesWatched: 60, PreconditionDrops: []string{"b"}},
		},
	}
	o := CampaignOutlook(c, "a", 40, now) // websocket says 40, inventory 30
	if o.Current == nil || o.Current.ID != "a" || o.Current.Progress != 40 {
		t.Fatalf("current = %+v, want a at 40", o.Current)
	}
	if o.Next == nil || o.Next.ID != "b" || o.Next.Progress != 0 {
		t.Fatalf("next = %+v, want b at 0 (gated drops don't get the live delta)", o.Next)
	}
	// Sequential: 20 + 60 + 60.
	if o.RemainingMinutes != 140 {
		t.Fatalf("remaining = %d, want 140", o.RemainingMinutes)
	}
	if !o.FinishesAfterCampaignEnd {
		t.Fatal("140 min of watching overruns a campaign ending in 120 min")
	}
}

func TestCampaignOutlookUnreachableAndDone(t *testing.T) {
	now := time.Now()
	c := twitch.DropCampaign{
		Drops: []twitch.TimeBasedDrop{
			{ID: "s", RequiredMinutesWatched: 30, RequiredSubs: 1},
			{ID: "x", RequiredMinutesWatched: 30, PreconditionDrops: []string{"s"}},
			{ID: "old", RequiredMinutesWatched: 30, EndAt: now.Add(-time.Hour)},
		},
	}
	o := CampaignOutlook(c, "", 0, now)
	if o.Current != nil || o.RemainingMinutes != 0 || o.Unreachable != 3 {
		t.Fatalf("got %+v, want nothing reachable and 3 unreachable", o)
	}

	done := twitch.DropCampaign{Drops: []twitch.TimeBasedDrop{
		{ID: "a", RequiredMinutesWatched: 30, CurrentMinutesWatched: 30, IsClaimed: true},
	}}
	o = CampaignOutlook(done, "", 0, now)
	if o.Position != 1 || o.Total != 1 || o.Current != nil {
		t.Fatalf("finished campaign: got %+v", o)
	}
}
