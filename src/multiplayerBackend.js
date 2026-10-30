import { TEAM_COLORS } from "./gameConfig";

/**
 * Dispatcher function for all multiplayer communications.
 */
export const tobackend = (data) => {
  console.log("[TO_BACKEND]:", data);
};

/**
 * Mock data structure to simulate backend state.
 */
export const INITIAL_MULTIPLAYER_STATE = {
  currentRoom: null, // e.g. { code: "4821", hostId: "p_1", players: [...] }
  localPlayerId: null,
};

/**
 * Validates player name according to rules:
 * - Starts with an alphabet [a-zA-Z]
 * - Only alphanumeric and underscore [a-zA-Z0-9_]
 * - Length between 1 and 16
 */
export function validatePlayerName(name) {
  if (!name) return false;
  const regex = /^[a-zA-Z][a-zA-Z0-9_]{0,15}$/;
  return regex.test(name);
}

/**
 * Validates 4-digit numeric room code.
 */
export function validateRoomCode(code) {
  return /^\d{4}$/.test(code);
}

/**
 * Assigns an available team color randomly, avoiding duplicates if possible.
 */
export function pickRandomColor(existingPlayers = []) {
  const usedColors = new Set(existingPlayers.map((p) => p.color));
  const available = TEAM_COLORS.filter((c) => !usedColors.has(c));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }
  return TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];
}

/**
 * Computes display label "Xn" for each player:
 * - X is the capitalized initial letter of the name
 * - n is "" if only 1 player shares that initial;
 *   otherwise 1, 2, 3... ordered by arrival (join sequence / order in array).
 */
export function computePlayerBadges(players = []) {
  const countByInitial = {};
  players.forEach((p) => {
    const init = p.name ? p.name.charAt(0).toUpperCase() : "?";
    countByInitial[init] = (countByInitial[init] || 0) + 1;
  });

  const currentIdxByInitial = {};

  return players.map((p) => {
    const init = p.name ? p.name.charAt(0).toUpperCase() : "?";
    let badgeText = init;

    if (countByInitial[init] > 1) {
      currentIdxByInitial[init] = (currentIdxByInitial[init] || 0) + 1;
      badgeText = `${init}${currentIdxByInitial[init]}`;
    }

    return {
      ...p,
      badgeText,
    };
  });
}