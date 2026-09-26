//TODO: On android it uses a strange native dropdown and it's very ugly
export function YearDropdown({
  years,
  value,
  onChange,
}: {
  years: number[];
  value: number;
  onChange: (year: number) => void;
}) {
  return (
    <select className="year-dropdown t-small" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
