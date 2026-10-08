/** Original assets. All dimensions/offsets are in a 180×166 reference cell. */
const base={anchorX:.5,anchorY:.5,offsetX:0,offsetY:0,scale:1};
const painted=(column,row,width=170,height=166)=>({...base,src:'player/assets/symbol-atlas-original.png',width,height,crop:{x:column*512,y:row*512,width:512,height:512}});
// Generated atlas is 1983 x 793. Explicit source cells keep artwork replaceable.
const paintedV2=(column,row,width,height)=>({...base,src:'player/assets/symbol-atlas-original-v2.png',width,height,crop:{x:column*1983/5,y:row*793/2,width:1983/5,height:793/2}});
export const symbols={
 'high-1':{...paintedV2(0,0,176,164),offsetY:3,name:'explorer'},
 'high-2':{...paintedV2(1,0,171,166),offsetY:2,name:'pharaoh'},
 'high-3':{...paintedV2(2,0,146,148),name:'scarab'},
 'high-4':{...paintedV2(3,0,161,158),offsetY:3,name:'statue'},
 bird:{...painted(1,1,158,168),name:'bird'},
 scatter:{...paintedV2(4,0,151,160),name:'book'},
 'low-1':{...paintedV2(0,1,147,156),name:'A'},'low-2':{...paintedV2(1,1,149,156),name:'K'},
 'low-3':{...paintedV2(2,1,148,152),name:'Q'},'low-4':{...paintedV2(3,1,125,158),name:'J'},
 'low-5':{...paintedV2(4,1,166,155),name:'10'}
};
export const fixture={
 grid:[['high-1','low-1','low-3'],['high-2','low-2','low-1'],['high-3','low-3','low-4'],['low-2','low-1','high-4'],['low-2','low-3','low-1']],
 meters:{'[data-credit]':'499.60','[data-lines]':'9','[data-betline]':'0.05','[data-bet]':'0.45'}
};
