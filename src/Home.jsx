import React from "react";
import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1>Welcome back.</h1>
        <p>You are exactly where you need to be.</p>

        <Link to="/auth">
          <button style={styles.button}>Begin Today’s Ritual</button>
        </Link>

        <p style={styles.sub}>
          This is not motivation. This is remembrance.
        </p>
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
  button: {
    marginTop: "1.5rem",
    padding: "14px 24px",
    borderRadius: "999px",
    border: "none",
    background: "linear-gradient(180deg,#f5d27a,#caa14a)",
    color: "#2b1f05",
    fontWeight: "600",
    cursor: "pointer",
  },
  sub: {
    marginTop: "1rem",
    opacity: 0.8,
    fontSize: "0.9rem",
  },
};
