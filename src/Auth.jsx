import React from "react";
export default function Auth() {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2>Enter</h2>
        <p>This will be connected to Supabase next.</p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background:
      "radial-gradient(60% 60% at 50% 20%, #ffd36b 0%, #c89a2b 35%, #6b4f12 60%, #0f0f0f 100%)",
    color: "#ffe7a8",
    fontFamily: "Georgia, serif",
  },
  card: {
    background: "rgba(0,0,0,0.35)",
    padding: "2.5rem",
    borderRadius: "24px",
    textAlign: "center",
    maxWidth: "420px",
  },
};
