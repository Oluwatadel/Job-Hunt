import { AppMetadata } from "./AppMetadata";
import { ReactNode } from "react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { ThemeModeProvider } from "../helpers/themeMode";import { AuthProvider } from "../helpers/useAuth";
import { TooltipProvider } from "./Tooltip";import { SonnerToaster } from "./SonnerToaster";import { ScrollToHashElement } from "./ScrollToHashElement";
const client=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:60000}}});
export const GlobalContextProviders=({children}:{children:ReactNode})=><QueryClientProvider client={client}><AuthProvider><ThemeModeProvider><TooltipProvider><AppMetadata/><ScrollToHashElement/>{children}<SonnerToaster/></TooltipProvider></ThemeModeProvider></AuthProvider></QueryClientProvider>;