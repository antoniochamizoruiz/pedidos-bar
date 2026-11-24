# Pedidos por QR para el bar

Cada mesa tiene un QR. El cliente lo escanea, ve la carta, pide desde el móvil y el pedido aparece al instante en una pantalla de la barra. No necesita instalar nada ni crear cuenta.

## Qué incluye

| Dirección | Para quién | Qué hace |
| --- | --- | --- |
| `/?mesa=5` | Clientes | Carta, carrito, nota para el bar y seguimiento del pedido |
| `/barra` | Personal | Pedidos en directo en tres columnas, con aviso sonoro opcional |
| `/cierre` | Personal | Cierre de caja: total del día y de dónde sale |
| `/qr` | Personal | Genera e imprime los QR de todas las mesas |

El panel `/barra`, el cierre `/cierre` y el generador `/qr` piden usuario y contraseña. La carta es pública.

## Cierre de caja

En `/cierre` (también hay un botón en el panel de barra) ves, para el día que elijas:

- El **total ingresado**, el número de pedidos, el ticket medio y las unidades vendidas.
- De dónde viene: desglose **por categoría**, **por producto** y **por mesa**, con importe y porcentaje.
- Avisos: pedidos que siguen **sin entregar** y pedidos **cancelados**.

Reglas del cálculo:

- Solo cuentan como venta los pedidos en estado **Entregado**. Antes de cerrar, entrega o cancela los que queden abiertos en el panel de barra; el aviso amarillo te dice cuántos son.
- Los cancelados no suman.
- El día de negocio empieza a las 6:00 (`businessDayStartsAt` en `menu.json`), así que lo que se pida de madrugada cuenta para la jornada anterior. Cámbialo si tu bar abre más tarde de esa hora.
- **Guardar cierre de caja** hace una copia de los importes en ese momento. Esa copia no cambia aunque después se modifiquen pedidos. Se guarda en `data/closings.json` y aparece en "Cierres guardados".
- El botón **Imprimir** saca el cierre en papel.

El programa no sabe cómo se pagó cada pedido (efectivo o tarjeta), porque el cobro se hace fuera de la web. Es el total de lo pedido y entregado, no un arqueo del cajón.

## Probarlo en tu ordenador

Necesitas [Node.js](https://nodejs.org) 18 o superior. No hay que instalar paquetes.

```
STAFF_PASSWORD=pon-una-contraseña node server.js
```

Abre `http://localhost:3000/?mesa=1` para ver la carta y `http://localhost:3000/barra` (usuario `barra`) en otra pestaña para ver llegar los pedidos.

## Personalizar la carta

Edita `menu.json`: nombre del bar, número de mesas, categorías, productos y precios en euros. Reinicia el servidor para aplicar los cambios. La carta incluida es solo un ejemplo.

Si sirves alimentos, recuerda que la información de alérgenos debe estar disponible para el cliente. Puedes añadirla en el campo `desc` de cada producto.

## Ponerlo en internet

Para que los clientes entren desde sus móviles, el servidor debe estar publicado con una dirección `https://`. Sirve cualquier alojamiento que ejecute Node.js (un VPS pequeño, Render, Railway, Fly.io…). Variables de entorno:

- `STAFF_PASSWORD`: contraseña del personal. Obligatoria en producción. Si no la defines, se genera una al arrancar y se muestra en la consola.
- `STAFF_USER`: usuario del personal (por defecto `barra`).
- `PORT`: puerto (por defecto 3000).
- `TRUST_PROXY=1`: actívala si el servidor está detrás de un proxy o balanceador, para limitar peticiones por cliente correctamente.
- `DATA_DIR`: carpeta donde se guardan los pedidos (por defecto `data/`). En alojamientos con disco temporal, apúntala a un disco persistente.

Después abre `https://tu-direccion/qr`, comprueba la dirección, escanea un código con tu móvil y, si funciona, imprímelos.

## Cómo funciona

- El servidor recalcula los precios con `menu.json`, así que nadie puede alterar el importe desde el móvil.
- Cada mesa puede enviar hasta 4 pedidos por minuto y cada conexión hasta 30 cada 10 minutos, para frenar abusos.
- Los pedidos se guardan en `data/orders.json` durante 7 días, así que solo puedes consultar el cierre de esos días. Los cierres guardados se conservan en `data/closings.json` sin límite de tiempo.
- El panel de barra recibe los pedidos por una conexión en directo y se reconecta solo si se corta el wifi.

## Límites actuales

- No cobra online: el pago se hace en barra o en mesa, como indica el mensaje de la carta (`paymentNote` en `menu.json`).
- Un único servidor y un único panel de barra por instancia. Sirve para un local. Para varios locales haría falta una base de datos.
- Cualquier persona que escanee un QR puede indicar cualquier mesa. Si te preocupa, el camarero puede confirmar la mesa al servir.
