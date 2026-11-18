import { ClipboardList, Home, ShoppingBasket, User } from "lucide-react";

/** Persistent bottom tab bar: Home, Buy Anything, Orders, Account. `active` is one of the tab keys. */
export default function BottomNav({ active, orderCount = 0, onHome, onBuy, onOrders, onAccount }) {
  const tabs = [
    { key: "home", label: "Home", Icon: Home, onClick: onHome },
    { key: "buy", label: "Buy Anything", Icon: ShoppingBasket, onClick: onBuy },
    { key: "orders", label: "Orders", Icon: ClipboardList, onClick: onOrders, badge: orderCount },
    { key: "account", label: "Account", Icon: User, onClick: onAccount },
  ];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-16 max-w-md border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
      {tabs.map(({ key, label, Icon, onClick, badge }) => {
        const on = active === key;
        return (
          <button key={key} type="button" onClick={onClick} aria-current={on ? "page" : undefined} className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${on ? "text-[#E8431A]" : "text-slate-500"}`}>
            {on && <span className="absolute inset-x-6 top-0 h-0.5 bg-[#E8431A]" aria-hidden="true" />}
            <Icon className="h-6 w-6" strokeWidth={on ? 2.4 : 2} />
            {label}
            {badge > 0 && <span className="absolute right-[22%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-lg bg-[#E8431A] px-1 text-[10px] font-bold tabular-nums text-white">{badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}
