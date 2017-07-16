import { action, observable, reaction } from 'mobx';
import { observer } from 'mobx-react';
import * as React from 'react';

import EditorDriver from 'drivers/base';
import { DialogType } from 'utils/Constants';
import { CSLProcessor } from 'utils/CSLProcessor';
import DevTools, { configureDevtool } from 'utils/DevTools';
import { getRemoteData, parseManualData } from '../API';
import { Store } from '../Store';

import { Spinner } from 'components/Spinner';
import Dialog from 'dialogs';
import { ItemList } from './ItemList';
import { Menu } from './Menu';
import { PanelButton } from './PanelButton';

const DevTool = DevTools();
configureDevtool({ logFilter: change => change.type === 'action' });

interface Props {
    editor: EditorDriver;
    store: Store;
}

@observer
export class ReferenceList extends React.Component<Props> {
    static readonly errors = top.ABT_i18n.errors;
    static readonly labels = top.ABT_i18n.referenceList.referenceList;

    processor: CSLProcessor;

    /**
     * The id of the currently opened modal
     */
    currentDialog = observable(DialogType.NONE);

    /**
     * Observable array of selected item IDs
     */
    selected = observable<string>([]);

    /**
     * Toggles the main loading spinner for the Reference List. Loading is true
     * until the editor driver's `init()` method resolves and also during any
     * circumstance where the editor becomes hidden or unavailable.
     */
    loading = observable(true);

    /**
     * UI State
     */
    ui = {
        loading: observable(true),
        pinned: observable(false),
        menuOpen: observable(false),
        cited: observable({
            isOpen: true,
            maxHeight: '400px',
        }),
        uncited: observable({
            isOpen: false,
            maxHeight: '400px',
        }),
    };

    constructor(props: Props) {
        super(props);
        this.processor = new CSLProcessor(this.props.store);
        this.init();

        /** React to list toggles */
        reaction(
            () => [this.ui.cited.isOpen, this.ui.uncited.isOpen, this.ui.menuOpen.get()],
            this.handleScroll,
            { fireImmediately: false, delay: 200 }
        );

        /** React to list pin/unpin */
        reaction(
            () => this.ui.pinned.get(),
            () => {
                document.getElementById('abt-reflist')!.classList.toggle('fixed');
                this.handleScroll();
            }
        );

        /** React to cited list changes */
        reaction(() => this.props.store.citations.citedIDs.length, this.handleScroll, {
            fireImmediately: false,
            delay: 200,
        });
    }

    componentDidMount() {
        // FIXME:
        // addEventListener(OPEN_REFERENCE_WINDOW, this.openReferenceWindow);
        // addEventListener(TINYMCE_READY, this.initTinyMCE);
        // addEventListener(REFERENCE_EDITED, this.initProcessor);
        // addEventListener(TOGGLE_PINNED_STATE, this.togglePinned);
        addEventListener(EditorDriver.events.HIDE, this.toggleLoading.bind(this, true));
        addEventListener(EditorDriver.events.SHOW, this.toggleLoading.bind(this, false));
        document.addEventListener('scroll', this.handleScroll);
    }

    componentWillUnmount() {
        removeEventListener(EditorDriver.events.HIDE, this.toggleLoading.bind(this, true));
        removeEventListener(EditorDriver.events.SHOW, this.toggleLoading.bind(this, false));
        document.removeEventListener('scroll', this.handleScroll);
    }

    init = async () => {
        await this.props.editor.init();
        this.initProcessor();
        this.toggleLoading(false);
    };

    @action togglePinned = () => this.ui.pinned.set(!this.ui.pinned.get());

    @action toggleMenu = () => this.ui.menuOpen.set(!this.ui.menuOpen.get());

    @action clearSelection = () => this.selected.clear();

    @action
    toggleLoading = (loadState?: boolean) =>
        this.loading.set(loadState !== undefined ? loadState : !this.loading.get());

    initProcessor = async () => {
        this.props.editor.setLoadingState(true);
        try {
            const clusters = await this.processor.init();
            await this.props.editor.composeCitations(
                clusters,
                this.props.store.citations.citationByIndex,
                this.processor.citeproc.opt.xclass
            );
            await this.props.editor.setBibliography(
                this.props.store.bibOptions,
                this.processor.makeBibliography()
            );
            this.clearSelection();
        } catch (err) {
            Rollbar.error('ReferenceLissett.tsx -> initProcessor', err);
            this.props.editor.alert(
                `${ReferenceList.errors.unexpected.message}.\n\n` +
                    `${err.name}: ${err.message}\n\n` +
                    `${ReferenceList.errors.unexpected.reportInstructions}`
            );
        }
        this.props.editor.setLoadingState(false);
    };

    @action
    deleteCitations = () => {
        if (this.selected.length === 0) return;
        this.props.editor.setLoadingState(true);
        const toRemove = this.props.store.citations.removeItems(this.selected);
        this.props.editor.removeItems(toRemove);
        this.clearSelection();
        this.initProcessor();
    };

    @action
    addReferences = async (payload: any) => {
        let data: CSL.Data[];
        let err: string;
        try {
            [data, err] = payload.addManually
                ? parseManualData(payload)
                : await getRemoteData(payload.identifierList);
            if (err) {
                this.props.editor.alert(err);
            }
        } catch (e) {
            // tslint:disable-next-line:no-console
            Rollbar.error('ReferenceList.tsx -> openReferenceWindow', e);
            this.props.editor.alert(
                `${ReferenceList.errors.unexpected.message}.\n\n` +
                    `${e.name}: ${e.message}\n\n` +
                    `${ReferenceList.errors.unexpected.reportInstructions}`
            );
            return;
        }

        if (data.length === 0) return;
        this.props.store.citations.addItems(data);

        // FIXME: Maybe hash the key or something instead of doing all this work
        // to check for duplicates.

        /*
            data = data.reduce((prev, curr) => {
                let matchingKey = '';
                const title = curr.title!.toLowerCase();

                for (const [key, value] of this.props.store.citations.CSL.entries()) {
                    if (value.title!.toLowerCase() !== title) continue;

                    const deepMatch = Object.keys(value).every(k => {
                        const isComplexDataType =
                            typeof value[k] !== 'string' && typeof value[k] !== 'number';
                        const isVariableKey = k === 'id' || k === 'language';
                        return isComplexDataType || isVariableKey ? true : value[k] === curr[k];
                    });

                    if (deepMatch) {
                        matchingKey = key;
                        break;
                    }
                }

                return matchingKey !== ''
                    ? [...prev, this.props.store.citations.CSL.get(matchingKey)]
                    : [...prev, curr];
            }, []) as CSL.Data[];
        */

        return payload.attachInline ? this.insertInlineCitation(undefined, data) : void 0;
    };

    @action
    handleMenuSelection = (kind: string, data?: string) => {
        switch (kind) {
            case 'CHANGE_STYLE':
                this.props.store.setStyle(data!);
                this.initProcessor();
                return;
            case 'IMPORT_RIS':
                this.currentDialog.set(DialogType.IMPORT);
                return;
            case 'REFRESH_PROCESSOR':
                const IDs = this.props.editor.citationIds;
                this.props.store.citations.pruneOrphanedCitations(IDs);
                this.initProcessor();
                return;
            case 'DESTROY_PROCESSOR': {
                this.reset();
                return;
            }
            case 'INSERT_STATIC_BIBLIOGRAPHY': {
                this.insertStaticBibliography();
                return;
            }
            default:
                return;
        }
    };

    @action
    toggleList = (id: string, explode: boolean = false) => {
        switch (id) {
            case 'cited':
                if (explode) {
                    this.ui.cited.isOpen = true;
                    this.ui.uncited.isOpen = false;
                    break;
                }
                this.ui.cited.isOpen = !this.ui.cited.isOpen;
                break;
            case 'uncited':
                if (explode) {
                    this.ui.cited.isOpen = false;
                    this.ui.uncited.isOpen = true;
                    break;
                }
                this.ui.uncited.isOpen = !this.ui.uncited.isOpen;
                break;
            default:
                break;
        }
    };

    @action
    reset = () => {
        this.props.editor.setLoadingState(true);
        this.clearSelection();
        this.ui.uncited.isOpen = false;
        this.ui.cited.isOpen = true;
        this.props.store.reset();
        this.props.editor.reset();
        this.initProcessor();
    };

    @action
    openDialog = (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
        const dialog = e.currentTarget.dataset.dialog || '';
        this.currentDialog.set(dialog);
    };

    @action
    handleDialogSubmit = (data: any) => {
        switch (this.currentDialog.get()) {
            case DialogType.ADD:
                this.addReferences(data);
                break;
            case DialogType.IMPORT:
                this.props.store.citations.addItems(data);
        }
        // FIXME:
        // tslint:disable-next-line:no-console
        console.log(data);
        this.currentDialog.set(DialogType.NONE);
    };

    render() {
        if (this.loading.get()) {
            return (
                <div>
                    <Spinner size="40px" height="52px" bgColor="#f5f5f5" />
                    <StorageField store={this.props.store} />
                </div>
            );
        }

        return (
            <div>
                <DevTool position={{ left: 50, top: 40 }} />
                <Dialog currentDialog={this.currentDialog} onSubmit={this.handleDialogSubmit} />
                <StorageField store={this.props.store} />
                <div className="abt-panel">
                    <PanelButton
                        disabled={this.selected.length === 0}
                        onClick={this.insertInlineCitation}
                        data-tooltip={ReferenceList.labels.tooltips.insert}
                    >
                        <span className="dashicons dashicons-migrate insert-inline" />
                    </PanelButton>
                    <PanelButton
                        disabled={this.selected.length !== 0}
                        onClick={this.openDialog}
                        data-dialog="ADD"
                        data-tooltip={ReferenceList.labels.tooltips.add}
                    >
                        <span className="dashicons dashicons-plus add-reference" />
                    </PanelButton>
                    <PanelButton
                        disabled={this.selected.length === 0}
                        onClick={this.deleteCitations}
                        data-tooltip={ReferenceList.labels.tooltips.remove}
                    >
                        <span className="dashicons dashicons-minus remove-reference" />
                    </PanelButton>
                    <PanelButton
                        onClick={this.togglePinned}
                        data-tooltip={ReferenceList.labels.tooltips.pin}
                    >
                        <span
                            className={
                                this.ui.pinned.get()
                                    ? 'dashicons dashicons-admin-post pin-reflist_fixed'
                                    : 'dashicons dashicons-admin-post pin-reflist'
                            }
                        />
                    </PanelButton>
                    <PanelButton onClick={this.toggleMenu}>
                        <span
                            className={
                                this.ui.menuOpen.get()
                                    ? 'dashicons dashicons-no-alt hamburger-menu'
                                    : 'dashicons dashicons-menu hamburger-menu'
                            }
                        />
                    </PanelButton>
                </div>
                <Menu
                    isOpen={this.ui.menuOpen}
                    itemsSelected={this.selected.length > 0}
                    cslStyle={this.props.store.citationStyle}
                    submitData={this.handleMenuSelection}
                />
                {this.props.store.citations.cited.length > 0 &&
                    <ItemList
                        id="cited"
                        CSL={this.props.store.citations.CSL}
                        items={this.props.store.citations.cited}
                        selectedItems={this.selected}
                        ui={this.ui.cited}
                        toggle={this.toggleList}
                        children={ReferenceList.labels.citedItems}
                    />}
                {this.props.store.citations.uncited.length > 0 &&
                    <ItemList
                        id="uncited"
                        CSL={this.props.store.citations.CSL}
                        items={this.props.store.citations.uncited}
                        selectedItems={this.selected}
                        ui={this.ui.uncited}
                        toggle={this.toggleList}
                        children={ReferenceList.labels.uncitedItems}
                    />}
            </div>
        );
    }

    // prettier-ignore
    insertInlineCitation = async (e?: React.MouseEvent<HTMLAnchorElement>, d: CSL.Data[] | Event = []) => {
            let data: CSL.Data[] = [];
            if (e) e.preventDefault();
            this.props.editor.setLoadingState(true);

            /**
             * If no data, then this must be a case where we're inserting from the
             *   list selection.
             */
            if (d instanceof Event || d.length === 0) {
                this.selected.forEach(id => {
                    data.push(this.props.store.citations.CSL.get(id)!);
                });
            } else {
                data = d;
            }

            /**
             * Checks to see if there is a inline citation selected. If so, extract the ids
             *   from it and push it to data.
             */
            const selection = this.props.editor.selection;
            if (/<span.+class="(?:abt-citation|abt_cite).+?<\/span>/.test(selection)) {
                const re = /&quot;(\w+?)&quot;/g;
                let m: RegExpExecArray | null;
                // tslint:disable-next-line
                while ((m = re.exec(selection)) !== null) {
                    data.push(this.props.store.citations.CSL.get(m[1])!);
                }
            }

            let clusters;
            try {
                const {
                    currentIndex,
                    locations: [citationsBefore, citationsAfter],
                } = this.props.editor.getRelativeCitationPositions(
                    Object.keys(
                        this.processor.citeproc.registry.citationreg.citationById
                    )
                );
                const citationData = this.processor.prepareInlineCitationData(
                    data,
                    currentIndex
                );
                clusters = this.processor.processCitationCluster(
                    citationData,
                    citationsBefore,
                    citationsAfter
                );
            } catch (err) {
                Rollbar.error('ReferenceList.tsx -> insertInlineCitation', err);
                this.props.editor.alert(
                    `${ReferenceList.errors.unexpected.message}.\n\n` +
                        `${err.name}: ${err.message}\n\n` +
                        `${ReferenceList.errors.unexpected.reportInstructions}`
                );
                this.props.editor.setLoadingState(false);
                this.clearSelection();
                return;
            }

            try {
                this.props.editor.composeCitations(clusters, this.props.store.citations.citationByIndex, this.processor.citeproc.opt.xclass);
                this.props.editor.setBibliography(this.props.store.bibOptions, this.processor.makeBibliography());
            } catch (err) {
                Rollbar.error('ReferenceList.tsx -> insertInlineCitation', err);
                this.props.editor.alert(
                    `${ReferenceList.errors.unexpected.message}.\n\n` +
                        `${err.name}: ${err.message}\n\n` +
                        `${ReferenceList.errors.unexpected.reportInstructions}`
                );
            }
            this.props.editor.setLoadingState(false);
            this.clearSelection();
        };

    insertStaticBibliography = async () => {
        const data: CSL.Data[] = [];
        this.selected.forEach(id => {
            data.push(this.props.store.citations.CSL.get(id)!);
        });

        const selection = this.props.editor.selection;
        if (/^<div class=".*?abt-static-bib.*?".+<\/div>$/g.test(selection)) {
            const re = /<div id="(\w{8,9})">/g;
            let m: RegExpExecArray | null;
            // tslint:disable-next-line
            while ((m = re.exec(selection)) !== null) {
                data.push(this.props.store.citations.CSL.get(m[1])!);
            }
        }

        try {
            const bibliography = await this.processor.createStaticBibliography(data);
            this.clearSelection();
            this.props.editor.setBibliography(this.props.store.bibOptions, bibliography, true);
        } catch (err) {
            Rollbar.error('ReferenceList.tsx -> insertStaticBibliography', err);
            this.props.editor.alert(
                `${ReferenceList.errors.unexpected.message}.\n\n` +
                    `${err.name}: ${err.message}\n\n` +
                    `${ReferenceList.errors.unexpected.reportInstructions}`
            );
        }
    };

    @action
    handleScroll = () => {
        const list = document.getElementById('abt-reflist')!;

        if (!this.ui.pinned.get()) {
            this.ui.cited.maxHeight = '400px';
            this.ui.uncited.maxHeight = '400px';
            list.style.top = '';
            return;
        }

        const bothOpen: boolean =
            this.ui.cited.isOpen &&
            this.ui.uncited.isOpen &&
            this.props.store.citations.cited.length > 0 &&
            this.props.store.citations.uncited.length > 0;

        const scrollpos = document.body.scrollTop;

        /**
         * Offset from top of reference list to top of viewport.
         */
        const topOffset = scrollpos > 134 ? 55 : scrollpos === 0 ? 95 : 95 - scrollpos / 3;

        /**
         * Vertical space that is already allocated.
         * 180 = all static, non-participating sections of the list + padding
         * 84 = vertical height of menu when open
         */
        const listOffset = 180 + topOffset + (this.ui.menuOpen.get() ? 84 : 0);
        const remainingHeight = window.innerHeight - listOffset;

        list.style.top = `${topOffset}px`;
        if (!bothOpen) {
            this.ui.cited.maxHeight = `calc(100vh - ${listOffset}px)`;
            this.ui.uncited.maxHeight = `calc(100vh - ${listOffset}px)`;
            return;
        }

        const cited = document.getElementById('cited')!;
        const uncited = document.getElementById('uncited')!;
        let citedHeight = 0;
        let uncitedHeight = 0;

        for (const child of Array.from(cited.children)) {
            citedHeight += child.clientHeight + 1;
            if (citedHeight > remainingHeight / 2) {
                citedHeight = remainingHeight / 2;
                break;
            }
        }

        for (const child of Array.from(uncited.children)) {
            uncitedHeight += child.clientHeight + 1;
            if (uncitedHeight > remainingHeight / 2) {
                uncitedHeight = remainingHeight / 2;
                break;
            }
        }

        const allocatedHeight = citedHeight + uncitedHeight;

        if (allocatedHeight < remainingHeight) {
            if (citedHeight > uncitedHeight) {
                citedHeight += remainingHeight - allocatedHeight;
            } else {
                uncitedHeight += remainingHeight - allocatedHeight;
            }
        }

        this.ui.cited.maxHeight = `${citedHeight}px`;
        this.ui.uncited.maxHeight = `${uncitedHeight}px`;
    };
}

@observer
class StorageField extends React.Component<{ store: Store }> {
    render() {
        return <input type="hidden" name="abt-reflist-state" value={this.props.store.persistent} />;
    }
}