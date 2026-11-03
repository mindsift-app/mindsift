import React from 'react';

// Rows inside a task card keep taps on their own controls; taps on empty space or plain labels
// (due date, webhook) reach the card and open the task
export const stopOnControl = (e: React.MouseEvent) => {
  if ((e.target as HTMLElement).closest('button, select, a, input')) e.stopPropagation();
};
