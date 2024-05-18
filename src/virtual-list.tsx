import {
  Ref,
  defineComponent,
  onActivated,
  onBeforeMount,
  onMounted,
  onUnmounted,
  ref,
  watch,
  renderSlot,
} from 'vue';
import Virtual from './virtual';
import { Item, Slot } from './item';
import { VirtualProps } from './props';

enum EVENT_TYPE {
  ITEM = 'itemResize',
  SLOT = 'slotResize',
}

enum SLOT_TYPE {
  HEADER = 'thead', // string value also use for aria role attribute
  FOOTER = 'tfoot',
}

interface Range {
  start: number;
  end: number;
  padFront: number;
  padBehind: number;
}

export default defineComponent({
  name: 'VirtualList',
  props: VirtualProps,
  emits: [
    'resized',
    'tobottom',
    'totop',
    'scroll',
    'dragoverItem',
    'dropItem',
    'rangeChange',
  ],
  setup(props, { emit, slots, expose }) {
    const isHorizontal = props.direction === 'horizontal';
    const directionKey = isHorizontal ? 'scrollLeft' : 'scrollTop';
    const range = ref<Range | null>(null);
    const root = ref<HTMLElement | null>();
    const shepherd = ref<HTMLDivElement | null>(null);
    let virtual: Virtual;
    const virtualRef: Ref<Virtual | null> = ref(null);

    /**
     * watch
     */
    watch(
      () => props.dataSources.length,
      () => {
        virtual.updateParam('uniqueIds', getUniqueIdFromDataSources());
        virtual.handleDataSourcesChange();
      },
    );
    watch(
      () => props.keeps,
      (newValue) => {
        virtual.updateParam('keeps', newValue);
        virtual.handleSlotSizeChange();
      },
    );
    watch(
      () => props.start,
      (newValue) => {
        scrollToIndex(newValue);
      },
    );
    watch(
      () => props.offset,
      (newValue) => scrollToOffset(newValue),
    );

    /**
     * methods
     */
    // get item size by id
    const getSize = (id) => {
      return virtual.sizes.get(id);
    };
    const getOffset = () => {
      if (props.pageMode) {
        return (
          document.documentElement[directionKey] || document.body[directionKey]
        );
      } else {
        return root.value ? Math.ceil(root.value[directionKey]) : 0;
      }
    };
    // return client viewport size
    const getClientSize = () => {
      const key = isHorizontal ? 'clientWidth' : 'clientHeight';
      if (props.pageMode) {
        return document.documentElement[key] || document.body[key];
      } else {
        return root.value ? Math.ceil(root.value[key]) : 0;
      }
    };
    // return all scroll size
    const getScrollSize = () => {
      const key = isHorizontal ? 'scrollWidth' : 'scrollHeight';
      if (props.pageMode) {
        return document.documentElement[key] || document.body[key];
      } else {
        return root.value ? Math.ceil(root.value[key]) : 0;
      }
    };
    const emitEvent = (offset, clientSize, scrollSize, evt) => {
      emit('scroll', evt, virtual.getRange());

      if (
        virtual.isFront() &&
        !!props.dataSources.length &&
        offset - props.topThreshold <= 0
      ) {
        emit('totop');
      } else if (
        virtual.isBehind() &&
        offset + clientSize + props.bottomThreshold >= scrollSize
      ) {
        emit('tobottom');
      }
    };
    const onScroll = (evt) => {
      const offset = getOffset();
      const clientSize = getClientSize();
      const scrollSize = getScrollSize();

      // iOS scroll-spring-back behavior will make direction mistake
      if (offset < 0 || offset + clientSize > scrollSize + 1 || !scrollSize) {
        return;
      }

      virtual.handleScroll(offset);
      emitEvent(offset, clientSize, scrollSize, evt);
    };

    const getUniqueIdFromDataSources = () => {
      const { dataKey, dataSources = [] } = props;
      return dataSources.map((dataSource: any) =>
        typeof dataKey === 'function'
          ? dataKey(dataSource)
          : dataSource[dataKey],
      );
    };
    const onRangeChanged = (newRange: any) => {
      range.value = newRange;
      emit('rangeChange', range);
    };
    const installVirtual = () => {
      virtual = new Virtual(
        {
          slotHeaderSize: 0,
          slotFooterSize: 0,
          keeps: props.keeps,
          estimateSize: props.estimateSize,
          buffer: Math.round(props.keeps / 3), // recommend for a third of keeps
          uniqueIds: getUniqueIdFromDataSources(),
        },
        onRangeChanged,
      );

      virtualRef.value = virtual;

      // sync initial range
      range.value = virtual.getRange();
    };
    // set current scroll position to a expectant index
    const scrollToIndex = (index: number) => {
      // scroll to bottom
      if (index >= props.dataSources.length - 1) {
        scrollToBottom();
      } else {
        const offset = virtual.getOffset(index);
        scrollToOffset(offset);
      }
    };
    // set current scroll position to a expectant offset
    const scrollToOffset = (offset: number) => {
      if (props.pageMode) {
        document.body[directionKey] = offset;
        document.documentElement[directionKey] = offset;
      } else {
        if (root.value) {
          root.value[directionKey] = offset;
        }
      }
    };
    // get the real render slots based on range data
    // in-place patch strategy will try to reuse components as possible
    // so those components that are reused will not trigger lifecycle mounted
    const getRenderSlots = (customItemSlot) => {
      const renders = [];
      const { start, end } = range.value!;
      const {
        dataSources,
        dataKey,
        itemClass,
        itemTag,
        itemStyle,
        extraProps,
      } = props;

      for (let index = start; index <= end; index++) {
        const dataSource = dataSources[index];
        if (dataSource) {
          const uniqueKey =
            typeof dataKey === 'function'
              ? dataKey(dataSource)
              : dataSource[dataKey];
          if (typeof uniqueKey === 'string' || typeof uniqueKey === 'number') {
            if (customItemSlot) {
              // Use the custom item slot to render the custom component
              renders.push(
                customItemSlot({
                  index,
                  key: uniqueKey,
                  uniqueKey,
                  item: dataSource,
                  style: itemStyle,
                  class: itemClass,
                  onItemResized,
                }),
              );
            } else {
              slots.push(
                <Item
                  key={uniqueKey}
                  index={index}
                  tag={itemTag}
                  event={EVENT_TYPE.ITEM}
                  horizontal={isHorizontal}
                  uniqueKey={uniqueKey}
                  source={dataSource}
                  extraProps={extraProps}
                  scopedSlots={slots}
                  style={itemStyle}
                  class={`${itemClass}${
                    props.itemClassAdd ? ' ' + props.itemClassAdd(index) : ''
                  }`}
                  onItemResize={onItemResized}
                  ondragover={(e: DragEvent) => onDragoverItem(e, dataSource)}
                  ondrop={(e: DragEvent) => onDropItem(e, dataSource)}
                />,
              );
            }
          } else {
            console.warn(
              `Cannot get the data-key '${dataKey}' from data-sources.`,
            );
          }
        } else {
          console.warn(`Cannot get the index '${index}' from data-sources.`);
        }
      }
      return renders;
    };

    // event called when each item mounted or size changed
    const onItemResized = (id: string, size: number) => {
      virtual.saveSize(id, size);
      emit('resized', id, size);
    };
    const virtualSaveSize = (id: string, size: number) => {
      virtual.saveSize(id, size);
    };

    const virtualGetOffset = (index: number) => {
      return virtual.getOffset(index);
    };
    function onDragoverItem(e: DragEvent, data: unknown) {
      emit('dragoverItem', e, data);
    }
    function onDropItem(e: DragEvent, data: unknown) {
      emit('dropItem', e, data);
    }

    // event called when slot mounted or size changed
    const onSlotResized = (type: SLOT_TYPE, size: number, hasInit: boolean) => {
      if (type === SLOT_TYPE.HEADER) {
        virtual.updateParam('slotHeaderSize', size);
      } else if (type === SLOT_TYPE.FOOTER) {
        virtual.updateParam('slotFooterSize', size);
      }

      if (hasInit) {
        virtual.handleSlotSizeChange();
      }
    };

    // set current scroll position to bottom
    const scrollToBottom = () => {
      if (shepherd.value) {
        const offset =
          shepherd.value[isHorizontal ? 'offsetLeft' : 'offsetTop'];
        scrollToOffset(offset);

        // check if it's really scrolled to the bottom
        // maybe list doesn't render and calculate to last range
        // so we need retry in next event loop until it really at bottom
        setTimeout(() => {
          if (getOffset() + getClientSize() < getScrollSize()) {
            scrollToBottom();
          }
        }, 3);
      }
    };

    // when using page mode we need update slot header size manually
    // taking root offset relative to the browser as slot header size
    const updatePageModeFront = () => {
      if (root.value) {
        const rect = root.value.getBoundingClientRect();
        const { defaultView } = root.value.ownerDocument;
        const offsetFront = isHorizontal
          ? rect.left + defaultView!.pageXOffset
          : rect.top + defaultView!.pageYOffset;
        virtual.updateParam('slotHeaderSize', offsetFront);
      }
    };

    // get the total number of stored (rendered) items
    const getSizes = () => {
      return virtual.sizes.size;
    };

    /**
     * life cycles
     */
    onBeforeMount(() => {
      installVirtual();
    });

    // set back offset when awake from keep-alive
    onActivated(() => {
      scrollToOffset(virtual.offset);
    });

    onMounted(() => {
      // set position
      if (props.start) {
        scrollToIndex(props.start);
      } else if (props.offset) {
        scrollToOffset(props.offset);
      }

      // in page mode we bind scroll event to document
      if (props.pageMode) {
        updatePageModeFront();
        document.addEventListener('scroll', onScroll, {
          passive: false,
        });
      }
    });

    onUnmounted(() => {
      virtual.destroy();
      if (props.pageMode) {
        document.removeEventListener('scroll', onScroll);
      }
    });

    function getRange() {
      return virtual.getRange();
    }

    /**
     * public methods
     */
    expose({
      scrollToBottom,
      getSizes,
      getSize,
      getRange,
      getOffset,
      getScrollSize,
      getClientSize,
      scrollToOffset,
      scrollToIndex,
      virtual: virtualRef,
      virtualSaveSize,
      virtualGetOffset,
      onScroll,
      updatePageModeFront,
    });

    return () => {
      const {
        pageMode,
        rootTag: RootTag,
        wrapTag: WrapTag,
        wrapClass,
        wrapStyle,
        headerTag,
        headerClass,
        headerStyle,
        footerTag,
        footerClass,
        footerStyle,
      } = props;
      const { padFront, padBehind } = range.value!;
      const paddingStyle = {
        padding: isHorizontal
          ? `0px ${padBehind}px 0px ${padFront}px`
          : `${padFront}px 0px ${padBehind}px`,
      };
      const wrapperStyle = wrapStyle
        ? Object.assign({}, wrapStyle, paddingStyle)
        : paddingStyle;
      const { header, footer } = slots;

      return (
        <RootTag ref={root} onScroll={!pageMode && onScroll}>
          {/* header slot */}
          {header && (
            <Slot
              class={headerClass}
              style={headerStyle}
              tag={headerTag}
              event={EVENT_TYPE.SLOT}
              uniqueKey={SLOT_TYPE.HEADER}
              onSlotResize={onSlotResized}
            >
              {header()}
            </Slot>
          )}

          {/* main list */}
          <WrapTag class={wrapClass} style={wrapperStyle}>
            {getRenderSlots(slots.item)}
          </WrapTag>

          {/* footer slot */}
          {footer && (
            <Slot
              class={footerClass}
              style={footerStyle}
              tag={footerTag}
              event={EVENT_TYPE.SLOT}
              uniqueKey={SLOT_TYPE.FOOTER}
              onSlotResize={onSlotResized}
            >
              {footer()}
            </Slot>
          )}

          {/* an empty element use to scroll to bottom */}
          <div
            ref={shepherd}
            style={{
              width: isHorizontal ? '0px' : '100%',
              height: isHorizontal ? '100%' : '0px',
            }}
          />
        </RootTag>
      );
    };
  },
});
