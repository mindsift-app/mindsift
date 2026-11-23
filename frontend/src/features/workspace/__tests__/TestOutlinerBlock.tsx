import React from 'react';
import { OutlinerBlock, type OutlinerBlockProps } from '../OutlinerBlock';
import { OutlinerActionsContext, type OutlinerActions } from '../OutlinerActionsContext';

const noop = () => {};

/** One bullet outside a tree, for tests: takes the bullet's props and the tree's actions (OutlinerTree gives
 *  those through OutlinerActionsContext) side by side; actions not given do nothing. */
export const TestOutlinerBlock: React.FC<OutlinerBlockProps & Partial<OutlinerActions>> = ({
  block,
  isLast,
  maxAllowedLevel,
  hasChildren,
  isFocused,
  canEdit,
  dropIndent,
  isTargeted,
  listMarker,
  siblingFollows,
  guides,
  lockedBy,
  originalLockedBy,
  inRangeSelection,
  ...actions
}) => (
  <OutlinerActionsContext.Provider
    value={{
      docId: 'd',
      levelOffset: 0,
      canAppendBelow: false,
      onUpdateBlock: noop,
      onCreateBlockBelow: noop,
      onDeleteBlock: noop,
      onIndentBlock: noop,
      onNavigateFocus: noop,
      registerTextareaRef: noop,
      ...actions,
    }}
  >
    <OutlinerBlock
      block={block}
      isLast={isLast}
      maxAllowedLevel={maxAllowedLevel}
      hasChildren={hasChildren}
      isFocused={isFocused}
      canEdit={canEdit}
      dropIndent={dropIndent}
      isTargeted={isTargeted}
      listMarker={listMarker}
      siblingFollows={siblingFollows}
      guides={guides}
      lockedBy={lockedBy}
      originalLockedBy={originalLockedBy}
      inRangeSelection={inRangeSelection}
    />
  </OutlinerActionsContext.Provider>
);
