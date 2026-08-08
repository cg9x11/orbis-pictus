import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { OrbisApp } from "./OrbisApp";

function SharePage() {
  const { id } = useParams<{ id: string }>();
  return <OrbisApp initialNodeId={id} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<OrbisApp />} />
        <Route path="/n/:id" element={<SharePage />} />
      </Routes>
    </BrowserRouter>
  );
}
