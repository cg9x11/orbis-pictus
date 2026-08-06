import type { ReactNode } from "react";

interface BrowserFrameProps {
  addressBar: ReactNode;
  toolbar?: ReactNode;
  /** Returns to the landing page. Omitted (and the button hidden) when already there. */
  onHome?: () => void;
  homeDisabled?: boolean;
  children: ReactNode;
}

export function BrowserFrame({ addressBar, toolbar, onHome, homeDisabled, children }: BrowserFrameProps) {
  return (
    <div className="browser-frame">
      <div className="browser-titlebar">
        <div className="window-dots">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>
        {onHome && (
          <button type="button" className="home-button" onClick={onHome} disabled={homeDisabled} title="Back to the start page">
            <span aria-hidden="true">⌂</span>
            <span className="home-button-text">Home</span>
          </button>
        )}
        {addressBar}
      </div>
      {toolbar && <div className="browser-toolbar">{toolbar}</div>}
      <div className="browser-content">{children}</div>
    </div>
  );
}
