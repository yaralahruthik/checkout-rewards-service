/** Formats integer cents as dollars without going through a float. */
export const formatCents = (cents: number): string => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = ((abs - (abs % 100)) / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
};
