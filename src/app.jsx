import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./Home.jsx";
import Auth from "./Auth.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
