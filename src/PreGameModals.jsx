import React from "react";
import { TEAM_COLORS } from "./gameConfig";

/**
 * PreGameModals encapsulates all overlay UI during the pre-game phases:
 * - INITIAL: Team color selection modal
 * - PLACE_HUNTERS / PLACE_RUNNER: Placement confirmation button
 * - COUNTDOWN: Large central countdown display
 */
export default function PreGameModals({
  gameState,
  selectedColor,
  ourTeamColor,
  placedHuntersCount,
  runnerPlaced,
  countdownNumber,
  onSelectTeamColor,
  onPressPlay,
  onConfirmHunters,
  onConfirmRunner,
}) {
  const isActualPlacementInteraction =
    gameState === "PLACE_HUNTERS" || gameState === "PLACE_RUNNER";

  const isConfirmDisabled =
    gameState === "PLACE_HUNTERS" ? placedHuntersCount < 3 : !runnerPlaced;

  return (
    <>
      {/* 1. INITIAL: 3x4 COLOR PICKER MODAL */}
      {gameState === "INITIAL" && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "24px 28px",
            background: "rgba(18, 20, 24, 0.88)",
            backdropFilter: "blur(14px)",
            borderRadius: "20px",
            border: `2px solid ${selectedColor || "rgba(255, 255, 255, 0.2)"}`,
            boxShadow: selectedColor
              ? `0 0 25px ${selectedColor}66, 0 8px 32px rgba(0,0,0,0.7)`
              : "0 8px 32px rgba(0,0,0,0.7)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            userSelect: "none",
            transition: "border 0.2s ease, box-shadow 0.2s ease",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              fontWeight: "700",
              letterSpacing: "1.5px",
              color: "#a0a5b0",
              textTransform: "uppercase",
              marginBottom: "16px",
            }}
          >
            Select Team Color
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 52px)",
              gridTemplateRows: "repeat(3, 52px)",
              gap: "12px",
              marginBottom: "20px",
            }}
          >
            {TEAM_COLORS.map((color) => {
              const isSelected = selectedColor === color;
              return (
                <button
                  key={color}
                  onClick={() => onSelectTeamColor(color)}
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "14px",
                    backgroundColor: color,
                    border: isSelected
                      ? "3.5px solid #ffffff"
                      : "2px solid rgba(0, 0, 0, 0.4)",
                    boxShadow: isSelected
                      ? `0 0 14px ${color}, inset 0 0 4px rgba(0,0,0,0.4)`
                      : "0 2px 6px rgba(0,0,0,0.3)",
                    transform: isSelected ? "scale(1.08)" : "scale(1)",
                    cursor: "pointer",
                    outline: "none",
                    padding: 0,
                    transition:
                      "transform 0.15s ease, border 0.15s ease, box-shadow 0.15s ease",
                  }}
                />
              );
            })}
          </div>

          <button
            onClick={onPressPlay}
            disabled={!selectedColor}
            style={{
              padding: "10px 42px",
              fontSize: "16px",
              fontWeight: "800",
              letterSpacing: "1px",
              borderRadius: "24px",
              border: "none",
              backgroundColor: selectedColor || "#3a3d45",
              color: "#ffffff",
              cursor: selectedColor ? "pointer" : "not-allowed",
              boxShadow: selectedColor ? `0 4px 16px ${selectedColor}88` : "none",
              opacity: selectedColor ? 1 : 0.4,
              transition: "all 0.2s ease",
              outline: "none",
            }}
          >
            PLAY
          </button>
        </div>
      )}

      {/* 2. COUNTDOWN: LARGE NUMBER IN SCREEN CENTER */}
      {gameState === "COUNTDOWN" && (
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
      )}

      {/* 3. PLACEMENT PHASES: BOTTOM CONFIRM BUTTON */}
      {isActualPlacementInteraction && (
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
      )}
    </>
  );
}