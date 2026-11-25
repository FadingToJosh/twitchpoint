package web

import (
	"testing"
	"time"

	"github.com/miwi/twitchpoint/internal/channels"
	"github.com/miwi/twitchpoint/internal/drops"
	"github.com/miwi/twitchpoint/internal/twitch"
)

func TestBuildStreamDeckSummary(t *testing.T) {
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	camp := twitch.DropCampaign{
		ID:    "c1",
		EndAt: now.Add(24 * time.Hour),
		Drops: []twitch.TimeBasedDrop{
			{ID: "d1", RequiredMinutesWatched: 30, CurrentMinutesWatched: 30, IsClaimed: true},
			{ID: "d2", RequiredMinutesWatched: 60, CurrentMinutesWatched: 60, IsClaimed: true},
			{ID: "d3", RequiredMinutesWatched: 90, CurrentMinutesWatched: 90, IsClaimed: true},
			{ID: "d4", BenefitName: "Skin 4", RequiredMinutesWatched: 120, CurrentMinutesWatched: 50},
			{ID: "d5", BenefitName: "Skin 5", RequiredMinutesWatched: 240, CurrentMinutesWatched: 50},
		},
	}
	rows := []drops.ActiveDrop{
		{CampaignID: "c1", CampaignName: "Season Drops", GameName: "Rust", DropName: "Skin 4", DropID: "d4",
			ChannelLogin: "bob", Progress: 56, Required: 120, Status: "ACTIVE", ClaimedDrops: 3, WatchableDrops: 5, EndAt: camp.EndAt},
		{CampaignID: "c9", CampaignName: "Late", GameName: "Apex", Status: "QUEUED", EndAt: now.Add(time.Hour)},
		{CampaignID: "c8", CampaignName: "Valo Event", GameName: "Valorant", Status: "QUEUED", EndAt: now.Add(72 * time.Hour)},
		{CampaignID: "c7", CampaignName: "More Rust", GameName: "rust", Status: "QUEUED"},
	}
	chans := []channels.Snapshot{
		{Login: "alice", DisplayName: "Alice", IsWatching: true, GameName: "Just Chatting"},
		{Login: "bob", DisplayName: "Bob", IsWatching: true, GameName: "Rust"},
		{Login: "carol", IsOnline: true},
	}
	lookup := func(id string) (twitch.DropCampaign, bool) { return camp, id == camp.ID }

	s := buildStreamDeckSummary(rows, chans, []string{"Rust", "Valorant", "Apex"}, lookup, now)

	if s.Watching == nil || s.Watching.Login != "bob" || !s.Watching.IsDropTarget {
		t.Fatalf("watching = %+v, want bob as drop target", s.Watching)
	}
	if len(s.AlsoWatching) != 1 || s.AlsoWatching[0] != "Alice" {
		t.Fatalf("also_watching = %v", s.AlsoWatching)
	}
	d := s.Drop
	if d == nil || d.Name != "Skin 4" || d.Progress != 56 || d.Required != 120 {
		t.Fatalf("drop = %+v", d)
	}
	if d.Position != 4 || d.Total != 5 {
		t.Fatalf("position %d/%d, want 4/5", d.Position, d.Total)
	}
	if d.Next == nil || d.Next.Name != "Skin 5" || d.Next.Progress != 56 {
		t.Fatalf("next = %+v, want Skin 5 at 56 (live delta applied)", d.Next)
	}
	if d.CampaignRemainingMinutes != 240-56 {
		t.Fatalf("remaining = %d, want 184", d.CampaignRemainingMinutes)
	}
	// Valorant outranks Apex in wanted_games even though Apex ends sooner;
	// the other Rust campaign is the same game and doesn't count.
	if s.NextGame == nil || s.NextGame.Game != "Valorant" || s.NextGame.Source != "queue" || s.NextGame.Rank != 2 {
		t.Fatalf("next_game = %+v, want Valorant from queue rank 2", s.NextGame)
	}
}

func TestBuildStreamDeckSummaryIdle(t *testing.T) {
	none := func(string) (twitch.DropCampaign, bool) { return twitch.DropCampaign{}, false }
	s := buildStreamDeckSummary(nil, nil, []string{"Rust", "Apex"}, none, time.Now())
	if s.Watching != nil || s.Drop != nil {
		t.Fatalf("expected empty summary, got %+v", s)
	}
	if s.NextGame == nil || s.NextGame.Game != "Rust" || s.NextGame.Source != "wanted_games" {
		t.Fatalf("next_game = %+v, want Rust from wanted_games", s.NextGame)
	}
}
