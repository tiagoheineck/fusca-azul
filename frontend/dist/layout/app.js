const menu = document.getElementById("menu");
const fecharMenu = document.getElementById("fecharMenu");

fecharMenu.onclick = () => {
    menu.classList.remove("ativo");
}

function toggleMenu() {
    menu.classList.toggle("ativo");
}