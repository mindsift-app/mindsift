import React, { useCallback, useRef, useState } from 'react';
import { PriorityLevel, Thought } from '../lib/types';
import { api, triggerHaptic } from '../lib/api';
import { useVoiceInput } from '../lib/useVoiceInput';
import i18n from '../i18n';
import { showError } from '../components/ErrorNotice';
import { errorMessage } from '../lib/errorMessage';

// State of the Quick Dump sheet on phones: text, priority, due date and voice input; saving puts the
// thought into the inbox
export function useMobileCapture(
  handleCaptured: (thought: Thought, target?: 'inbox' | 'task' | 'list_item' | 'document') => void
) {
  const [showMobileCapture, setShowMobileCapture] = useState(false);
  const [mobileTriageContent, setMobileTriageContent] = useState('');
  const [mobileTriagePriority, setMobileTriagePriority] = useState<PriorityLevel>('normal');
  const [mobileTriageDueDate, setMobileTriageDueDate] = useState('');
  const [isVoiceCaptured, setIsVoiceCaptured] = useState(false);
  const [mobileVoiceError, setMobileVoiceError] = useState<string | null>(null);
  const mobileBaseVoiceRef = useRef('');
  // Voice input of the mobile capture sheet: own Whisper server or the browser (lib/voice.ts)
  const mobileVoice = useVoiceInput({
    chunked: true,
    onText: (text) => {
      if (!text) return;
      const base = mobileBaseVoiceRef.current;
      setMobileTriageContent(base ? `${base} ${text}` : text);
      setIsVoiceCaptured(true);
    },
    onError: (message) => {
      setMobileVoiceError(message);
      window.setTimeout(() => setMobileVoiceError(null), 4000);
    },
  });
  const mobileVoiceActive = mobileVoice.state === 'listening';

  const toggleMobileVoice = () => {
    if (mobileVoice.state === 'idle') {
      mobileBaseVoiceRef.current = mobileTriageContent.replace(/\s*\[…\]$/, '').trim();
      setMobileVoiceError(null);
      triggerHaptic(20);
    }
    mobileVoice.toggle();
  };

  const handleMobileCreateTriage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = mobileTriageContent.trim();
    if (!trimmed) return;
    try {
      const thought = await api.captureThought(
        trimmed,
        mobileTriagePriority,
        isVoiceCaptured ? 'voice' : 'manual',
        mobileTriageDueDate,
        { target: 'inbox' }
      );
      handleCaptured(thought, 'inbox');
      setMobileTriageContent('');
      setMobileTriagePriority('normal');
      setMobileTriageDueDate('');
      setIsVoiceCaptured(false);
      setShowMobileCapture(false);
      triggerHaptic(20);
    } catch (err) {
      showError(i18n.t('common:errors.saveFailed', { message: errorMessage(err, i18n.t('common:errors.unknown')) }));
    }
  };

  // Stays the same function: views register it once as their "+", so it reads the voice input as it is now
  const mobileVoiceRef = useRef(mobileVoice);
  mobileVoiceRef.current = mobileVoice;
  const openMobileTriageCapture = useCallback(() => {
    setMobileTriageContent('');
    setMobileTriagePriority('normal');
    setMobileTriageDueDate('');
    setIsVoiceCaptured(false);
    if (mobileVoiceRef.current.state !== 'idle') mobileVoiceRef.current.cancel();
    setShowMobileCapture(true);
  }, []);

  return {
    showMobileCapture,
    setShowMobileCapture,
    mobileTriageContent,
    setMobileTriageContent,
    mobileTriagePriority,
    setMobileTriagePriority,
    mobileTriageDueDate,
    setMobileTriageDueDate,
    mobileVoiceError,
    mobileVoice,
    mobileVoiceActive,
    toggleMobileVoice,
    handleMobileCreateTriage,
    openMobileTriageCapture,
  };
}
