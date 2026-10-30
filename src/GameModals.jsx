import React, { useState } from "react";
import { TEAM_COLORS } from "./gameConfig";
import {
  validatePlayerName,
  validateRoomCode,
  computePlayerBadges,
} from "./multiplayerBackend";

export default function GameModals({
  gameState, // "LANDING" | "JOIN_ROOM" | "ROOM" | "INTRO" | "PLACE_HUNTERS" | "PLACE_RUNNER" | "FOG_FADE" | "COUNTDOWN" | "PLAYING"
  playerName,
  setPlayerName,
  roomData, // { code: string, hostId: string, players: [{ id, name, color, numericId }] }
  localPlayerId,
  ourTeamColor,
  placedHuntersCount,
  runnerPlaced,
  countdownNumber,
  onCreateRoom,
  onJoinRoomSubmit,
  onLeaveRoom,
  onReassignHost,
  onStartGame,
  onNavigateToJoin,
  onBackToLanding,
  onSelectTeamColor,
  onConfirmHunters,
  onConfirmRunner,
}) {
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [nameError, setNameError] = useState("");
  const [codeError, setCodeError] = useState("");

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
  if (gameState === "LANDING") {
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
  if (gameState === "JOIN_ROOM") {
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
            placeholder="????"
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

  // ---------------- PAGE 3: ROOM MODAL (3x4 Grid) ----------------
  if (gameState === "ROOM" && roomData) {
    const playersWithBadges = computePlayerBadges(roomData.players || []);
    const isHost = roomData.hostId === localPlayerId;
    const playerCount = playersWithBadges.length;

    // Fast lookup for color occupants
    const playerByColor = new Map();
    playersWithBadges.forEach((p) => {
      playerByColor.set(p.color.toLowerCase(), p);
    });

    const handleBoxClick = (color) => {
      const occupant = playerByColor.get(color.toLowerCase());
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

        {/* 3x4 Color Grid */}
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
                    transition: "transform 0.15s ease",
                  }}
                  title="Choose this color"
                />
              );
            }

            const isPlayerHost = player.id === roomData.hostId;
            const isSelf = player.id === localPlayerId;

            // Border rule: Sharp yellow for self, white for others
            const borderColor = isSelf ? "#FFD700" : "#ffffff";
            const borderWidth = isSelf ? "3px" : "2px";
            const boxShadow = isSelf
              ? "0 0 12px #FFD700aa, 0 2px 8px rgba(0,0,0,0.4)"
              : "0 2px 8px rgba(0,0,0,0.4)";

            // Top-left circle indicator: Sharp yellow border & text for the host
            const idCircleBorder = isPlayerHost
              ? "1.5px solid #FFD700"
              : "1px solid rgba(255, 255, 255, 0.4)";
            const idCircleTextColor = isPlayerHost ? "#FFD700" : "#ffffff";

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
                {/* Numeric Player ID Circle */}
                <div
                  style={{
                    position: "absolute",
                    top: "3px",
                    left: "3px",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(0, 0, 0, 0.75)",
                    color: idCircleTextColor,
                    fontSize: "9px",
                    fontWeight: "900",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: idCircleBorder,
                  }}
                >
                  {player.numericId}
                </div>

                {/* Capitalized Name Initial + Sequence (Xn) */}
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

  // ---------------- COUNTDOWN OVERLAY ----------------
  if (gameState === "COUNTDOWN") {
    return (
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 80,
          fontSize: "110px",
          fontWeight: "900",
          WebkitTextStroke: "6px #000000",
          paintOrder: "stroke fill",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontVariantNumeric: "tabular-nums",
          userSelect: "none",
          pointerEvents: "none",
          textShadow:
            "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 8px 24px rgba(0,0,0,0.9)",
        }}
      >
        {countdownNumber}
      </div>
    );
  }

  // ---------------- UNIT PLACEMENT CONFIRM BUTTON ----------------
  const isActualPlacementInteraction =
    gameState === "PLACE_HUNTERS" || gameState === "PLACE_RUNNER";

  if (isActualPlacementInteraction) {
    const isConfirmDisabled =
      gameState === "PLACE_HUNTERS" ? placedHuntersCount < 3 : !runnerPlaced;

    return (
      <button
        onClick={
          gameState === "PLACE_HUNTERS" ? onConfirmHunters : onConfirmRunner
        }
        disabled={isConfirmDisabled}
        style={{
          position: "absolute",
          bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          padding: "12px 42px",
          fontSize: "16px",
          fontWeight: "800",
          letterSpacing: "1.2px",
          borderRadius: "28px",
          border: "none",
          backgroundColor: ourTeamColor,
          color: "#ffffff",
          boxShadow: `0 4px 20px ${ourTeamColor}88, 0 2px 8px rgba(0,0,0,0.6)`,
          cursor: !isConfirmDisabled ? "pointer" : "not-allowed",
          opacity: !isConfirmDisabled ? 1 : 0.45,
          zIndex: 60,
          transition: "all 0.2s ease",
          outline: "none",
        }}
      >
        CONFIRM
      </button>
    );
  }

  return null;
}