import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

// March3D is a real-time Three.js renderer. StrictMode intentionally mounts
// components twice in development, which is useful for ordinary React apps
// but unnecessarily doubles the cost of constructing a large drill scene.
createRoot(document.getElementById("root")!).render(<App />);
