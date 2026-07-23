import { type View as ViewType } from 'react-native';

import { NovaScopeTabs } from '@/components/nova/NovaScopeTabs';

import { searchScopeLabel } from './searchScopes';
import type { SearchScope } from './searchTypes';

type SearchScopeChipsProps = {
  activeScope: SearchScope;
  onSelectScope: (scope: SearchScope) => void;
  focusUpHandle?: number;
  focusDownHandle?: number;
  focusLeftHandle?: number;
  firstTabRef?: React.RefObject<ViewType | null>;
};

const SCOPES: SearchScope[] = ['all', 'live', 'movie', 'series', 'guide'];

export function SearchScopeChips({
  activeScope,
  onSelectScope,
  focusUpHandle,
  focusDownHandle,
  focusLeftHandle,
  firstTabRef,
}: SearchScopeChipsProps) {
  return (
    <NovaScopeTabs
      options={SCOPES}
      activeOption={activeScope}
      labelForOption={(scope) => searchScopeLabel(scope)}
      onSelectOption={onSelectScope}
      focusUpHandle={focusUpHandle}
      focusDownHandle={focusDownHandle}
      focusLeftHandle={focusLeftHandle}
      firstTabRef={firstTabRef}
    />
  );
}
