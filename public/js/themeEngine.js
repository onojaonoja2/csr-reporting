function toggleSystemTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('elkris-theme', isDark ? 'dark' : 'light');
}
