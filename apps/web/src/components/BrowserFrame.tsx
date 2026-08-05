import type { ReactNode } from "react";

interface BrowserFrameProps {
  addressBar: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}

export function BrowserFrame({ addressBar, toolbar, children }: BrowserFrameProps) {
  return (
    <div className="browser-frame">
      <div className="browser-titlebar">
        <div className="window-dots">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>
        {addressBar}
      </div>
      {toolbar && <div className="browser-toolbar">{toolbar}</div>}
      <div className="browser-content">{children}</div>
    </div>
  );
}
