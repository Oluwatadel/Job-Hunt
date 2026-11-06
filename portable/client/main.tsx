import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { GlobalContextProviders } from "../../floot/components/_globalContextProviders";
import { pages } from "../generated/pages";
import "../../floot/base.css";
createRoot(document.getElementById("root")!).render(<BrowserRouter><GlobalContextProviders><Routes>{pages.map(p => <Route key={p.path} path={p.path} element={p.element}/>) }<Route path="*" element={<main><h1>Page not found</h1><a href="/">Back to Job Hunt</a></main>}/></Routes></GlobalContextProviders></BrowserRouter>);
