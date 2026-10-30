import React, { useState } from "react";
import { TEAM_COLORS } from "./gameConfig";
import {
  validatePlayerName,
  validateRoomCode,
  computePlayerBadges,
} from "./multiplayerBackend";

export default function MultiplayerModals({
  multiplayerPage, // "LANDING" | "JOIN_ROOM" | "ROOM" | null
  playerName,
  setPlayerName,
  roomData, // { code: string, hostId: string, players: [{ id, name, color, numericId }] }
  localPlayerId,
  onCreateRoom,
  onJoinRoomSubmit,
  onLeaveRoom,
  onReassignHost,
  onStartGame,
  onNavigateToJoin,
  onBackToLanding,
  onSelectTeamColor,
}) {
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [nameError, setNameError] = useState("");
  const [codeError, setCodeError] = useState("");

  if (!multiplayerPage) return null;

  const modalContainerStyle = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 70,
    display: "flex",
    flexDirection: "column",
    padding: "26px 30px",
    background: "rgba(18, 20, 24, 0.92)",
    backdropFilter: "blur(16px)",
    borderRadius: "24px",
    border: "1.5px solid rgba(255, 255, 255, 0.15)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    userSelect: "none",
    color: "#ffffff",
    boxSizing: "border-box",
  };

  const inputStyle = {
    width: "100%",
    padding: "12px 14px",
    fontSize: "15px",
    fontWeight: "600",
    borderRadius: "12px",
    border: "1.5px solid rgba(255, 255, 255, 0.25)",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    color: "#ffffff",
    outline: "none",
    boxSizing: "border-box",
    textAlign: "center",
  };

  const buttonPrimaryStyle = {
    padding: "12px 20px",
    fontSize: "15px",
    fontWeight: "800",
    borderRadius: "14px",
    border: "none",
    backgroundColor: "#ffffff",
    color: "#121418",
    cursor: "pointer",
    transition: "transform 0.1s ease, opacity 0.2s ease",
  };

  const buttonSecondaryStyle = {
    padding: "12px 20px",
    fontSize: "15px",
    fontWeight: "700",
    borderRadius: "14px",
    border: "1.5px solid rgba(255, 255, 255, 0.25)",
    backgroundColor: "transparent",
    color: "#ffffff",
    cursor: "pointer",
  };

  // ---------------- PAGE 1: LANDING MODAL ----------------
  if (multiplayerPage === "LANDING") {
    const handleCreate = () => {
      if (!validatePlayerName(playerName)) {
        setNameError(
          "Must start with a letter, max 16 chars, letters/numbers/_ only."
        );
        return;
      }
      setNameError("");
      onCreateRoom(playerName);
    };

    const handleJoinClick = () => {
      if (!validatePlayerName(playerName)) {
        setNameError(
          "Must start with a letter, max 16 chars, letters/numbers/_ only."
        );
        return;
      }
      setNameError("");
      onNavigateToJoin();
    };

    return (
      <div style={{ ...modalContainerStyle, width: "380px" }}>
        <h1
          style={{
            margin: "0 0 6px 0",
            fontSize: "22px",
            fontWeight: "900",
            textAlign: "center",
            letterSpacing: "0.5px",
          }}
        >
          Hong Kong Hide and Seek
        </h1>
        <p
          style={{
            margin: "0 0 24px 0",
            fontSize: "12px",
            color: "#a0a5b0",
            textAlign: "center",
          }}
        >
          an Undarfly project by Ulfred Chan, since 2025 June
        </p>

        <div style={{ marginBottom: "16px" }}>
          <input
            type="text"
            placeholder="Enter player name"
            maxLength={16}
            value={playerName}
            onChange={(e) => {
              setPlayerName(e.target.value);
              setNameError("");
            }}
            style={inputStyle}
          />
          {nameError && (
            <div
              style={{
                fontSize: "11px",
                color: "#ff6b6b",
                marginTop: "6px",
                textAlign: "center",
              }}
            >
              {nameError}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button style={buttonPrimaryStyle} onClick={handleCreate}>
            Create Room
          </button>
          <button style={buttonSecondaryStyle} onClick={handleJoinClick}>
            Join Room
          </button>
        </div>
      </div>
    );
  }

  // ---------------- PAGE 2: JOIN ROOM MODAL ----------------
  if (multiplayerPage === "JOIN_ROOM") {
    const handleJoin = () => {
      if (!validateRoomCode(roomCodeInput)) {
        setCodeError("Room code must be a 4-digit number.");
        return;
      }
      setCodeError("");
      onJoinRoomSubmit(roomCodeInput);
    };

    return (
      <div style={{ ...modalContainerStyle, width: "340px" }}>
        <h2
          style={{
            margin: "0 0 20px 0",
            fontSize: "20px",
            fontWeight: "800",
            textAlign: "center",
          }}
        >
          Join Room
        </h2>

        <div style={{ marginBottom: "18px" }}>
          <input
            type="text"
            placeholder="4-digit code"
            maxLength={4}
            value={roomCodeInput}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              setRoomCodeInput(val);
              setCodeError("");
            }}
            style={{
              ...inputStyle,
              fontSize: "24px",
              letterSpacing: "6px",
            }}
          />
          {codeError && (
            <div
              style={{
                fontSize: "11px",
                color: "#ff6b6b",
                marginTop: "6px",
                textAlign: "center",
              }}
            >
              {codeError}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button style={buttonPrimaryStyle} onClick={handleJoin}>
            Join Room
          </button>
          <button style={buttonSecondaryStyle} onClick={onBackToLanding}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // ---------------- PAGE 3: ROOM MODAL ----------------
  if (multiplayerPage === "ROOM" && roomData) {
    const playersWithBadges = computePlayerBadges(roomData.players || []);
    const isHost = roomData.hostId === localPlayerId;
    const playerCount = playersWithBadges.length;

    // Map players by color for O(1) grid lookup
    const playerByColor = new Map();
    playersWithBadges.forEach((p) => {
      playerByColor.set(p.color.toLowerCase(), p);
    });

    const handleBoxClick = (color) => {
      const occupant = playerByColor.get(color.toLowerCase());
      // Only unselected boxes can be selected
      if (!occupant) {
        onSelectTeamColor(color);
      }
    };

    return (
      <div style={{ ...modalContainerStyle, width: "340px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "18px",
          }}
        >
          <div style={{ fontSize: "20px", fontWeight: "900" }}>
            Room {roomData.code}
          </div>
          <div
            style={{
              fontSize: "13px",
              fontWeight: "800",
              color: "#a0a5b0",
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              padding: "4px 10px",
              borderRadius: "12px",
            }}
          >
            {playerCount}/8
          </div>
        </div>

        {/* 3x4 Color Grid (12 colors) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 56px)",
            gridTemplateRows: "repeat(3, 56px)",
            gap: "12px",
            justifyContent: "center",
            marginBottom: "22px",
          }}
        >
          {TEAM_COLORS.map((color) => {
            const player = playerByColor.get(color.toLowerCase());

            if (!player) {
              // Unselected color: No text, unbordered, clickable to pick
              return (
                <button
                  key={color}
                  onClick={() => handleBoxClick(color)}
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "14px",
                    backgroundColor: color,
                    border: "none",
                    outline: "none",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                    cursor: "pointer",
                    padding: 0,
                    transition: "transform 0.15s ease, opacity 0.15s ease",
                  }}
                  title="Click to take this color"
                />
              );
            }

            // Occupied box by a player
            const isPlayerHost = player.id === roomData.hostId;
            const isSelf = player.id === localPlayerId;

            // Border styling: Sharp Yellow (Host), Pale Yellow (Self), White (Others)
            let borderColor = "#ffffff";
            let borderWidth = "2px";
            let boxShadow = "0 2px 8px rgba(0,0,0,0.4)";

            if (isPlayerHost) {
              borderColor = "#FFD700"; // Sharp yellow
              borderWidth = "3px";
              boxShadow = "0 0 12px #FFD700aa";
            } else if (isSelf) {
              borderColor = "#FFF9A6"; // Pale yellow
              borderWidth = "2.5px";
              boxShadow = "0 0 10px #FFF9A688";
            }

            return (
              <div
                key={color}
                style={{
                  position: "relative",
                  width: "56px",
                  height: "56px",
                  borderRadius: "14px",
                  backgroundColor: player.color,
                  border: `${borderWidth} solid ${borderColor}`,
                  boxShadow,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  fontWeight: "900",
                  fontSize: "20px",
                  boxSizing: "border-box",
                  textShadow:
                    "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 1px 3px rgba(0,0,0,0.8)",
                  cursor: "default",
                }}
                title={`${player.name} (${
                  isPlayerHost ? "Host" : isSelf ? "You" : "Player"
                })`}
              >
                {/* Numeric Player ID on Top-Left */}
                <div
                  style={{
                    position: "absolute",
                    top: "3px",
                    left: "3px",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(0, 0, 0, 0.7)",
                    color: "#ffffff",
                    fontSize: "9px",
                    fontWeight: "800",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid rgba(255, 255, 255, 0.4)",
                  }}
                >
                  {player.numericId}
                </div>

                {/* Initial Badge (Xn) */}
                <span>{player.badgeText}</span>
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {isHost && (
            <>
              <button
                style={{
                  ...buttonPrimaryStyle,
                  backgroundColor: "#2e7d32",
                  color: "#ffffff",
                  boxShadow: "0 4px 14px rgba(46, 125, 50, 0.5)",
                }}
                onClick={onStartGame}
              >
                Start Game
              </button>
              <button
                style={buttonSecondaryStyle}
                onClick={onReassignHost}
                disabled={playerCount <= 1}
              >
                Reassign Host
              </button>
            </>
          )}

          <button
            style={{
              ...buttonSecondaryStyle,
              borderColor: "#d32f2f",
              color: "#ff6b6b",
            }}
            onClick={onLeaveRoom}
          >
            Leave Room
          </button>
        </div>
      </div>
    );
  }

  return null;
}