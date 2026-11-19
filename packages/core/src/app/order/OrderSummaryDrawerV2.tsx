import {
    type LineItemMap,
    type ShopperCurrency as ShopperCurrencyType,
    type StoreCurrency,
} from '@bigcommerce/checkout-sdk';
import classNames from 'classnames';
import React, {
    type FunctionComponent,
    type KeyboardEvent,
    type ReactNode,
    useContext,
    useState,
} from 'react';
import ReactModal from 'react-modal';

import { useLocale } from '@bigcommerce/checkout/contexts';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import { IconChevronDown, IconChevronUp } from '@bigcommerce/checkout/ui';

import { CartOutstandingBalance } from '../cart/CartOutstandingBalance';
import { CartSummaryItemImage } from '../cart/CartSummaryItemImage';
import { useSheetDismissDrag } from '../cart/useSheetDismissDrag';
import { type OrderSummarySubtotalsProps } from '../coupon';
import { ShippingQuoteSummaryContext } from '../warehouse/ShippingQuoteSummary';

import getItemsCount from './getItemsCount';
import getLineItemsCount from './getLineItemsCount';
import OrderSummary from './OrderSummary';
import { getNonBundledItems } from './removeBundledItems';

const SHEET_TRANSITION_DURATION = 600;

export interface OrderSummaryDrawerV2Props extends OrderSummarySubtotalsProps {
    lineItems: LineItemMap;
    total: number;
    headerLink: ReactNode;
    storeCurrency: StoreCurrency;
    shopperCurrency: ShopperCurrencyType;
    bundledItems?: Pick<LineItemMap, 'physicalItems' | 'digitalItems'>;
}

export const OrderSummaryDrawerV2: FunctionComponent<OrderSummaryDrawerV2Props> = ({
    lineItems,
    total,
    headerLink,
    storeCurrency,
    shopperCurrency,
    bundledItems,
    ...subtotalProps
}) => {
    const quote = useContext(ShippingQuoteSummaryContext);
    const { nonBundledItems } = getNonBundledItems(lineItems, bundledItems);

    const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
    const [{ isExpanded, generation }, setSheetState] = useState({
        isExpanded: false,
        generation: 0,
    });

    const closeSheet = () => {
        setSheetState((state) => ({ ...state, isExpanded: false }));
    };

    const { setSheetElement, handleProps: sheetHandleProps } = useSheetDismissDrag(
        isExpanded,
        closeSheet,
    );

    const { language } = useLocale();
    const cartHeading = language.translate('cart.cart_heading');

    const toggleSheet = () => {
        // A new modal instance cancels the previous close timer and animation frame,
        // including a close/reopen before react-modal has reached its afterOpen state.
        setSheetState((state) => ({
            isExpanded: !state.isExpanded,
            generation: state.generation + (state.isExpanded ? 0 : 1),
        }));
    };

    const handleBarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleSheet();
        }
    };

    return (
        <div className="cart-summary-drawer enhancedThemeV1" ref={setRootElement}>
            <div
                aria-controls="cart-summary-sheet"
                aria-expanded={isExpanded}
                className="cart-summary-collapsed-bar optimizedCheckout-orderSummary"
                data-test="cart-summary-collapsed-bar"
                onClick={toggleSheet}
                onKeyDown={handleBarKeyDown}
                role="button"
                tabIndex={0}
            >
                <figure
                    className={classNames('cart-summary-figure', {
                        'cart-summary-figure--stack': getLineItemsCount(nonBundledItems) > 1,
                    })}
                    data-test="cart-summary-figure"
                >
                    <div className="cart-summary-image-wrapper">
                        <CartSummaryItemImage lineItems={nonBundledItems} />
                    </div>
                </figure>
                <div className="cart-summary-bar-body">
                    <span className="body-regular" data-test="cart-item-count">
                        <TranslatedString
                            data={{ count: getItemsCount(nonBundledItems) }}
                            id="cart.item_count_text"
                        />
                    </span>
                    {quote.total ? (
                        <span role="status">{quote.total}</span>
                    ) : (
                        <CartOutstandingBalance
                            amount={total}
                            currencyCode={shopperCurrency.code}
                        />
                    )}
                </div>
                <span className="cart-summary-bar-toggle-label body-regular optimizedCheckout-orderSummary-toggle">
                    <TranslatedString
                        id={isExpanded ? 'cart.hide_details_action' : 'cart.show_details_action'}
                    />
                    {isExpanded ? <IconChevronDown /> : <IconChevronUp />}
                </span>
            </div>
            {rootElement && (
                <ReactModal
                    ariaHideApp={false}
                    bodyOpenClassName="has-activeCartSummarySheet"
                    className={{
                        base: 'cart-summary-sheet optimizedCheckout-orderSummary',
                        afterOpen: 'cart-summary-sheet--afterOpen',
                        beforeClose: 'cart-summary-sheet--beforeClose',
                    }}
                    closeTimeoutMS={SHEET_TRANSITION_DURATION}
                    contentElement={(contentProps, contentChildren) => (
                        <div {...contentProps} data-test="cart-summary-sheet">
                            {contentChildren}
                        </div>
                    )}
                    contentLabel={cartHeading}
                    contentRef={setSheetElement}
                    id="cart-summary-sheet"
                    isOpen={isExpanded}
                    key={generation}
                    onRequestClose={closeSheet}
                    overlayClassName={{
                        base: 'cart-summary-backdrop',
                        afterOpen: 'cart-summary-backdrop--afterOpen',
                        beforeClose: 'cart-summary-backdrop--beforeClose',
                    }}
                    overlayElement={(overlayProps, contentElement) => (
                        <div {...overlayProps} data-test="cart-summary-backdrop">
                            {contentElement}
                        </div>
                    )}
                    parentSelector={() => rootElement}
                >
                    <div
                        className="cart-summary-sheet-handle-region"
                        data-test="cart-summary-sheet-handle"
                        {...sheetHandleProps}
                    >
                        <div className="cart-summary-sheet-handle" />
                    </div>
                    <div className="cart-summary-sheet-content">
                        <OrderSummary
                            {...subtotalProps}
                            headerLink={headerLink}
                            lineItems={lineItems}
                            shopperCurrency={shopperCurrency}
                            storeCurrency={storeCurrency}
                            total={total}
                        />
                    </div>
                </ReactModal>
            )}
        </div>
    );
};
