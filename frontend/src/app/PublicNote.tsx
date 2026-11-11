import React from 'react';
import { useMainViews } from './useMainViews';
import { AppLoading } from './AppLoading';

// A note shared by public link: its view lives in the app's chunk (it uses the outliner), loaded right away
export const PublicNote: React.FC<{ token: string }> = ({ token }) => {
  const { views, failed, retry } = useMainViews(true);
  if (!views) return <AppLoading onRetry={failed ? retry : undefined} />;
  return <views.PublicNoteView token={token} />;
};
