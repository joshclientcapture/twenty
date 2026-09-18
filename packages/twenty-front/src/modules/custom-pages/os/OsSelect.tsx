import { Select } from '@/ui/input/components/Select';

type OsSelectProps<TValue extends string> = {
  id: string;
  value: TValue;
  options: { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
  disabled?: boolean;
  label?: string;
  fullWidth?: boolean;
  withSearch?: boolean;
};

// Twenty's own dropdown instead of the browser <select>, so every picker on the custom pages
// matches the rest of the CRM. `id` must be unique on the page: it names the dropdown instance.
export const OsSelect = <TValue extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  label,
  fullWidth,
  withSearch,
}: OsSelectProps<TValue>) => (
  <Select<TValue>
    dropdownId={`os-select-${id}`}
    selectSizeVariant="small"
    dropdownWidthAuto
    fullWidth={fullWidth}
    label={label}
    disabled={disabled}
    value={value}
    options={options.map((option) => ({
      value: option.value,
      label: option.label,
    }))}
    onChange={onChange}
    withSearchInput={withSearch}
  />
);
