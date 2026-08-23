"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.getElementById("menuTabs");
  const grid = document.getElementById("menuGrid");

  if (!tabs || !grid) return;

  const cards = [...grid.querySelectorAll("[data-category]")];
  const buttons = [...tabs.querySelectorAll("[data-category]")];

  const setCategory = (category) => {
    buttons.forEach((button) => {
      const active = button.dataset.category === category;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });

    cards.forEach((card) => {
      const visible = category === "all" || card.dataset.category === category;
      card.hidden = !visible;
    });
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => setCategory(button.dataset.category));
  });
});
