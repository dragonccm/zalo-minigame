import React, { useState, useEffect, useMemo } from "react";
import { api, CAT, num } from "../api";
import GameCard from "../components/GameCard";
import Icon from "../components/Icon";
import { useRoute } from "../App";

export default function HomePage({ searchQuery }) {
  const { navigate } = useRoute();
  const [games, setGames] = useState([]);
  const [categories, setCategories] = useState([]);
  const [topUsers, setTopUsers] = useState([]);
  const [selectedCat, setSelectedCat] = useState("");
  const [sort, setSort] = useState("popular");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([api("/api/games"), api("/api/leaderboard/global")])
      .then(([gData, topData]) => {
        if (!mounted) return;
        setGames(gData.games || []);
        setCategories(gData.categories || []);
        setTopUsers(topData.entries || []);
      })
      .catch(console.error)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const usedCategories = useMemo(() => {
    return categories.filter((c) =>
      games.some((g) => g.categories?.includes(c)),
    );
  }, [categories, games]);

  const filteredGames = useMemo(() => {
    const q = (searchQuery || "").toLowerCase();
    let list = games.filter((g) => {
      const matchCat = !selectedCat || g.categories?.includes(selectedCat);
      const matchQ =
        !q ||
        (g.name + " " + g.description + " " + (g.author || ""))
          .toLowerCase()
          .includes(q);
      return matchCat && matchQ;
    });

    list = [...list].sort((a, b) => {
      return sort === "new"
        ? (b.createdAt || 0) - (a.createdAt || 0)
        : (b.plays || 0) - (a.plays || 0);
    });
    return list;
  }, [games, selectedCat, searchQuery, sort]);

  if (loading) {
    return (
      <div className="center" style={{ padding: "60px" }}>
        <div className="spin" />
        <p className="muted">Đang tải danh sách game...</p>
      </div>
    );
  }

  return (
    <div className="layout-child">
      <div>
        {/* Category chips & Sort */}
        <div className="hometop">
          <div className="chips">
            <button
              className={`chip ${selectedCat === "" ? "on" : ""}`}
              onClick={() => setSelectedCat("")}
            >
              Tất cả
            </button>
            {usedCategories.map((c) => (
              <button
                key={c}
                className={`chip ${selectedCat === c ? "on" : ""}`}
                onClick={() => setSelectedCat(c)}
              >
                {CAT[c] || c}
              </button>
            ))}
          </div>

          <select
            id="sort"
            aria-label="Sắp xếp"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="popular">Phổ biến nhất</option>
            <option value="new">Mới nhất</option>
          </select>
        </div>

        {searchQuery && (
          <p className="muted small" style={{ marginBottom: "14px" }}>
            {filteredGames.length} game cho "{searchQuery}"
          </p>
        )}

        {/* Game Cards Grid */}
        <div className="cards">
          {filteredGames.length > 0 ? (
            filteredGames.map((game) => (
              <GameCard key={game.slug} game={game} />
            ))
          ) : (
            <p className="muted">Không tìm thấy game phù hợp.</p>
          )}
        </div>
      </div>
      {topUsers.length > 0 && (
        <section className="toprow">
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Icon name="trophy" /> Top người chơi
          </h3>
          <ol>
            {topUsers.slice(0, 5).map((e) => (
              <li key={e.user.username}>
                <span className="rk">{e.rank}</span>
                <span className="avatar">
                  <Icon name={e.user.avatar || "smile"} />
                </span>
                <a
                  className="nm"
                  href={`#/u/${encodeURIComponent(e.user.username)}`}
                  onClick={ev => {
                    if (ev.button === 0 && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
                      ev.preventDefault();
                      navigate('u', e.user.username);
                    }
                  }}
                >
                  {e.user.displayName}
                </a>
                <span className="sc">{num(e.xp)} XP</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
