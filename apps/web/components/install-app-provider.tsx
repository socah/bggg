'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallAppState {
  promptEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
  isIOS: boolean;
  clearPrompt: () => void;
}

const InstallAppContext = createContext<InstallAppState | null>(null);

export function InstallAppProvider({ children }: { children: React.ReactNode }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- install state only exists in browser APIs.
    setInstalled(standalone);
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return (
    <InstallAppContext value={{ promptEvent, installed, isIOS, clearPrompt: () => setPromptEvent(null) }}>
      {children}
    </InstallAppContext>
  );
}

export function useInstallApp(): InstallAppState {
  const context = useContext(InstallAppContext);
  if (!context) throw new Error('useInstallApp must be used inside InstallAppProvider');
  return context;
}
