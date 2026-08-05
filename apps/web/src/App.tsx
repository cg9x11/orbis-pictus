import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { FlipbookApp } from "./FlipbookApp";

function SharePage() {
  const { id } = useParams<{ id: string }>();
  return <FlipbookApp initialNodeId={id} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<FlipbookApp />} />
        <Route path="/n/:id" element={<SharePage />} />
      </Routes>
    </BrowserRouter>
  );
}
