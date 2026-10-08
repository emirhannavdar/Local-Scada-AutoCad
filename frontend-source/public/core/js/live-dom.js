// A native select must stay attached to preserve its open popup and keyboard focus.
// Defer option changes while the user is editing it; the next tick applies them after blur.
export function syncReferenceSelect(select,items,selected,documentObject=globalThis.document) {
  const signature=JSON.stringify(items.map(n=>[String(n.id),n.name]));
  if(documentObject.activeElement===select)return false;
  if(select.dataset.optionsKey!==signature){
    const options=items.length?items.map(n=>{const option=documentObject.createElement('option');option.value=String(n.id);option.textContent=n.name;return option;}):[Object.assign(documentObject.createElement('option'),{value:'',textContent:'Bağlı cihaz yok'})];
    select.replaceChildren(...options);select.dataset.optionsKey=signature;
  }
  const value=selected==null?'':String(selected);if(select.value!==value)select.value=value;
  select.disabled=!items.length;return true;
}
