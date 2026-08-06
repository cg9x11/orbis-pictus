import { useState } from "react";
import type { Node } from "@flipbook/shared";
import { classNames } from "../lib/classNames";

interface AddressBarProps {
  trail: Node[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onSubmit: (query: string) => void;
  disabled: boolean;
  /** Shown in place of the input while a tap generation is streaming, before the image arrives. */
  pendingLabel?: string;
  editMode: boolean;
}

export function AddressBar({ trail, currentIndex, onNavigate, onSubmit, disabled, pendingLabel, editMode }: AddressBarProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = value.trim();
    if (!query || disabled) return;
    onSubmit(query);
    setValue("");
  };

  return (
    <form className="address-bar" onSubmit={handleSubmit}>
      {trail.length > 0 && (
        <div className="breadcrumbs">
          {trail.map((node, i) => (
            <span key={node.id} className="crumb-wrap">
              <button
                type="button"
                className={classNames("crumb", { "crumb-current": i === currentIndex })}
                onClick={() => onNavigate(i)}
              >
                {node.page_title}
              </button>
              {i < trail.length - 1 && <span className="crumb-sep">/</span>}
            </span>
          ))}
        </div>
      )}
      {pendingLabel ? (
        <div className="address-pending">Loading: {pendingLabel}…</div>
      ) : (
        <input
          className="address-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={editMode ? "Type a command to edit this page…" : trail.length > 0 ? "Continue this session" : "Type anything…"}
          disabled={disabled}
        />
      )}
    </form>
  );
}
