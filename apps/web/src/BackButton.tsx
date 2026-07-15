import { useNavigate } from "react-router-dom";

/**
 * Standing rule: every game mode/tracker screen has a way back to where
 * you came from. History-based, so it works whether you arrived from an
 * event, from the home screen, or from a shared link (falls back to home
 * when there's no history to pop, e.g. a link opened in a fresh tab).
 */
export default function BackButton({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        if (window.history.length > 1) navigate(-1);
        else navigate("/");
      }}
      className={`gn-textbtn ${className}`}
    >
      &larr; Back
    </button>
  );
}
